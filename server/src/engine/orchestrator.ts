import { config } from '../config';
import type { Discussion, Intent, Panelist, Phase } from '../domain/types';
import { getEngine, type LlmEngine } from '../llm';
import { type Repo, getRepo } from '../db/repo';
import { eventBus } from './eventBus';
import {
  CONTEXT_WINDOW,
  buildInsightViews,
  buildPanelCards,
  buildRecentTurns,
  expertsOf,
  hostOf,
  speakersInRound,
} from './context';
import { MIN_SPEAKERS_PER_ROUND, TOTAL_ROUNDS, isFinalRound, orderSpeakers, phaseForRound } from './plan';

/**
 * 讨论引擎。
 *
 * 一场讨论 = 一个 DiscussionRuntime 实例，彼此完全隔离：
 * 独立的事件 seq、独立的状态机、独立的暂停/停止标志。
 *
 * 推进逻辑：
 *   主持人开场
 *   → 每轮：主持人抛问 → 各专家自主决定是否发言 → 按「反驳>补充>抢答」排序
 *           → 逐条生成 1-2 句发言 → 从增量 transcript 提炼共识/分歧
 *   → 主持人自然语言收尾
 *
 * 每一次状态变化都同时做两件事：落库（供回放）与广播（供 SSE 实时推送）。
 */

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

class DiscussionRuntime {
  private paused = false;
  private stopRequested = false;
  private completion: Promise<void> = Promise.resolve();
  private turns = 0;

  constructor(
    private readonly discussionId: string,
    private readonly repo: Repo,
    private readonly engine: LlmEngine,
  ) {}

  start(): void {
    this.completion = this.run()
      .catch((error: unknown) => this.fail(error))
      // 跑完（自然结束或被停止）后把自己从注册表摘掉，避免注册表无限增长
      .finally(() => {
        runtimes.delete(this.discussionId);
      });
  }

  /** 请求停止，并等待引擎真正收尾（含生成总结）。 */
  async stop(): Promise<void> {
    this.stopRequested = true;
    this.paused = false;
    await this.completion;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  get isRunning(): boolean {
    return !this.stopRequested;
  }

  // ---------------------------------------------------------- 主循环

  private async run(): Promise<void> {
    const discussion = this.repo.getDiscussion(this.discussionId);
    if (!discussion) throw new Error(`discussion not found: ${this.discussionId}`);

    const panelists = this.repo.getPanelists(this.discussionId);
    const host = hostOf(panelists);
    const experts = expertsOf(panelists);
    if (!host || experts.length === 0) throw new Error('阵容不完整：缺少主持人或专家');

    await this.setStatus('live', 'opening', 0);
    await this.delay();

    // ---- 开场 ----
    await this.hostSpeaks(host, 'open', 0, 'opening', 'opening');

    // ---- 逐轮推进 ----
    for (let round = 1; round <= TOTAL_ROUNDS; round += 1) {
      if (this.shouldStop()) break;
      const phase = phaseForRound(round);

      await this.setStatus('live', phase, round);
      await this.delay();

      // 第 2 轮起由主持人串联/追问，把讨论从"各自表态"推向"正面交锋"
      if (round > 1) {
        const previous = this.lastSpeakerOfRound(round - 1);
        const kind = round % 2 === 0 ? 'bridge' : 'question';
        await this.hostSpeaks(host, kind, round, phase, kind === 'question' ? 'question' : 'bridge', previous ?? undefined);
      }

      await this.runRound(round, phase, experts);

      if (this.shouldStop()) break;
      await this.synthesize(round);

      if (isFinalRound(round)) break;
    }

    // ---- 收尾 ----
    await this.closing(host, experts);
  }

  /** 一轮：先让专家各自决策，再按优先级依次发言。 */
  private async runRound(round: number, phase: Phase, experts: Panelist[]): Promise<void> {
    const transcript = this.repo.getTranscript(this.discussionId);
    const insights = buildInsightViews(this.repo.getInsights(this.discussionId), experts);
    const spokeThisRound = speakersInRound(transcript, round);
    const recentTurns = buildRecentTurns(transcript, this.panelistsCache(experts), CONTEXT_WINDOW.recentTurns);

    // 决策阶段并发发起，减少整体等待；每个专家只拿到裁剪过的上下文
    const decisions = await Promise.all(
      experts.map(async (expert) => ({
        panelistId: expert.id,
        decision: await this.engine.decideSpeak({
          topic: this.topic,
          background: this.background,
          phase,
          round,
          self: {
            id: expert.id,
            name: expert.name,
            title: expert.title,
            role: expert.role,
            stance: expert.stance,
            bio: expert.bio,
            focus: expert.focus,
          },
          spokeThisRound,
          recentTurns,
          insights,
        }),
      })),
    );

    let order = orderSpeakers(decisions);

    // 冷场兜底：若所有人都判断"没有增量"，按 urgency 拉最少必要人数发言
    if (order.length < MIN_SPEAKERS_PER_ROUND) {
      const fallback = [...decisions]
        .sort((a, b) => b.decision.urgency - a.decision.urgency)
        .map((item) => item.panelistId)
        .filter((id) => !order.includes(id));
      order = [...order, ...fallback].slice(0, MIN_SPEAKERS_PER_ROUND);
    }

    for (const panelistId of order) {
      if (this.shouldStop()) return;
      const expert = experts.find((item) => item.id === panelistId);
      const entry = decisions.find((item) => item.panelistId === panelistId);
      if (!expert || !entry) continue;
      if (this.turns >= config.engine.maxTurns) return;

      const decision = entry.decision;

      // 思考 → 发言 → 回到待机：这是前端"专家状态小窗"看到的三段变化
      this.setPanelistRuntime(expert.id, 'thinking', decision.focus || null);
      await this.delay();

      const roundSoFar = buildRecentTurns(
        this.repo.getTranscript(this.discussionId).filter((t) => t.round === round),
        this.panelistsCache(experts),
        CONTEXT_WINDOW.recentTurns,
      );

      let content: string;
      try {
        content = await this.engine.composeUtterance({
          topic: this.topic,
          background: this.background,
          phase,
          round,
          self: {
            id: expert.id,
            name: expert.name,
            title: expert.title,
            role: expert.role,
            stance: expert.stance,
            bio: expert.bio,
            focus: expert.focus,
          },
          spokeThisRound,
          recentTurns: buildRecentTurns(this.repo.getTranscript(this.discussionId), this.panelistsCache(experts)),
          insights: buildInsightViews(this.repo.getInsights(this.discussionId), experts),
          decision,
          roundSoFar,
        });
      } catch (error) {
        console.error('[engine] 生成发言失败，跳过该条:', (error as Error).message);
        this.setPanelistRuntime(expert.id, 'idle', null);
        continue;
      }

      this.setPanelistRuntime(expert.id, 'speaking', decision.focus || null);
      this.appendTranscript(expert, decision.intent, content, round, phase);
      this.turns += 1;
      await this.delay();

      this.setPanelistRuntime(expert.id, 'idle', decision.focus || null);
    }
  }

  // ---------------------------------------------------------- 阶段动作

  private async hostSpeaks(
    host: Panelist,
    intent: Intent,
    round: number,
    phase: Phase,
    kind: 'opening' | 'question' | 'bridge',
    target?: Panelist,
  ): Promise<void> {
    if (this.shouldStop()) return;
    const transcript = this.repo.getTranscript(this.discussionId);
    const panelists = this.repo.getPanelists(this.discussionId);

    this.setPanelistRuntime(host.id, 'thinking', null);

    let content: string;
    try {
      content = await this.engine.hostCue({
        topic: this.topic,
        background: this.background,
        phase,
        round,
        kind,
        host: {
          id: host.id,
          name: host.name,
          title: host.title,
          role: host.role,
          stance: host.stance,
          bio: host.bio,
          focus: host.focus,
        },
        panel: buildPanelCards(panelists.filter((p) => p.role === 'expert')),
        target: target
          ? {
              id: target.id,
              name: target.name,
              title: target.title,
              role: target.role,
              stance: target.stance,
              bio: target.bio,
              focus: target.focus,
            }
          : undefined,
        recentTurns: buildRecentTurns(transcript, panelists),
        insights: buildInsightViews(this.repo.getInsights(this.discussionId), panelists),
      });
    } catch (error) {
      console.error('[engine] 主持人发言失败:', (error as Error).message);
      this.setPanelistRuntime(host.id, 'idle', null);
      return;
    }

    this.setPanelistRuntime(host.id, 'speaking', null);
    this.appendTranscript(host, intent, content, round, phase);
    this.turns += 1;
    await this.delay();
    this.setPanelistRuntime(host.id, 'idle', null);
  }

  /** 从增量 transcript 提炼共识 / 分歧，并实时推送。 */
  private async synthesize(round: number): Promise<void> {
    const panelists = this.repo.getPanelists(this.discussionId);
    const transcript = this.repo.getTranscript(this.discussionId);
    const experts = panelists.filter((p) => p.role === 'expert');

    try {
      const synthesis = await this.engine.synthesize({
        topic: this.topic,
        background: this.background,
        round,
        panel: buildPanelCards(experts),
        transcript: buildRecentTurns(transcript, panelists, CONTEXT_WINDOW.synthesisTurns),
        previous: buildInsightViews(this.repo.getInsights(this.discussionId), panelists),
      });

      const changes = this.repo.reconcileInsights(this.discussionId, round, synthesis);
      for (const change of changes) {
        const event = this.repo.appendEvent(this.discussionId, 'insight.upsert', {
          insight: change.insight,
          isNew: change.isNew,
        });
        eventBus.publish(event);
      }
    } catch (error) {
      // 提炼失败不该中断讨论本身
      console.error('[engine] 共识提炼失败:', (error as Error).message);
    }
  }

  private async closing(host: Panelist, experts: Panelist[]): Promise<void> {
    await this.setStatus(this.stopRequested ? 'ended' : 'live', 'closing', TOTAL_ROUNDS);

    const panelists = this.repo.getPanelists(this.discussionId);
    let summary: string;
    try {
      summary = await this.engine.composeSummary({
        topic: this.topic,
        background: this.background,
        panel: buildPanelCards(experts),
        transcript: buildRecentTurns(this.repo.getTranscript(this.discussionId), panelists, 60),
        insights: buildInsightViews(this.repo.getInsights(this.discussionId), panelists),
      });
    } catch (error) {
      console.error('[engine] 总结生成失败:', (error as Error).message);
      summary = `关于「${this.topic}」的讨论到此结束。由于总结生成失败，请查看上方完整发言记录。`;
    }

    this.setPanelistRuntime(host.id, 'speaking', null);
    this.appendTranscript(host, 'summary', summary, TOTAL_ROUNDS, 'closing');
    this.setPanelistRuntime(host.id, 'idle', null);

    this.repo.updateDiscussion(this.discussionId, { summary, endedAt: Date.now() });
    const event = this.repo.appendEvent(this.discussionId, 'summary.final', { summary });
    eventBus.publish(event);

    await this.setStatus('ended', 'done', TOTAL_ROUNDS);
  }

  // ---------------------------------------------------------- 基础设施

  private panelistsCache(experts: Panelist[]): Panelist[] {
    const host = this.repo.getPanelists(this.discussionId).filter((p) => p.role === 'host');
    return [...host, ...experts];
  }

  private get topic(): string {
    return this.repo.getDiscussion(this.discussionId)?.topic ?? '';
  }

  private get background(): string | null {
    return this.repo.getDiscussion(this.discussionId)?.background ?? null;
  }

  private lastSpeakerOfRound(round: number): Panelist | null {
    const entries = this.repo.getTranscript(this.discussionId).filter((t) => t.round === round);
    const last = entries.at(-1);
    if (!last) return null;
    return this.repo.getPanelist(last.panelistId);
  }

  private shouldStop(): boolean {
    if (this.stopRequested) return true;
    if (this.turns >= config.engine.maxTurns) return true;
    // 讨论被外部删除 / 已被其它路径结束
    const discussion = this.repo.getDiscussion(this.discussionId);
    return !discussion || discussion.status === 'ended';
  }

  private appendTranscript(panelist: Panelist, intent: Intent, content: string, round: number, phase: Phase): void {
    const { event } = this.repo.appendTranscript(this.discussionId, {
      panelistId: panelist.id,
      round,
      phase,
      intent,
      content,
    });
    eventBus.publish(event);
  }

  private setPanelistRuntime(panelistId: string, status: Panelist['status'], focus: string | null): void {
    const updated = this.repo.setPanelistRuntime(panelistId, status, focus);
    if (!updated) return;
    const event = this.repo.appendEvent(this.discussionId, 'panelist.status', {
      panelistId: updated.id,
      status: updated.status,
      focus: updated.focus,
    });
    eventBus.publish(event);
  }

  private async setStatus(status: Discussion['status'], phase: Phase, round: number): Promise<void> {
    const updated = this.repo.updateDiscussion(this.discussionId, { status, phase, round });
    if (!updated) return;
    const event = this.repo.appendEvent(this.discussionId, 'discussion.status', {
      status: updated.status,
      phase: updated.phase,
      round: updated.round,
    });
    eventBus.publish(event);
    await sleep(0);
  }

  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[engine] 讨论 ${this.discussionId} 异常终止:`, message);
    try {
      const event = this.repo.appendEvent(this.discussionId, 'error', { message });
      eventBus.publish(event);
      this.repo.updateDiscussion(this.discussionId, { status: 'ended', phase: 'done', endedAt: Date.now() });
    } catch (nested) {
      console.error('[engine] 异常处理失败:', (nested as Error).message);
    }
  }

  /** 可中断的等待：暂停与停止都能在等待期间立即生效。 */
  private async delay(ms: number = config.engine.turnIntervalMs): Promise<void> {
    const step = 50;
    let elapsed = 0;
    while (elapsed < ms) {
      if (this.stopRequested) return;
      await sleep(Math.min(step, ms - elapsed));
      elapsed += step;
      await this.waitIfPaused();
    }
    await this.waitIfPaused();
  }

  private async waitIfPaused(): Promise<void> {
    while (this.paused && !this.stopRequested) {
      await sleep(120);
    }
  }
}

// ------------------------------------------------------------ 运行时注册表

const runtimes = new Map<string, DiscussionRuntime>();

export function startDiscussionRuntime(discussionId: string, repo: Repo = getRepo()): void {
  if (runtimes.has(discussionId)) return;
  const runtime = new DiscussionRuntime(discussionId, repo, getEngine());
  runtimes.set(discussionId, runtime);
  runtime.start();
}

export async function stopDiscussionRuntime(discussionId: string): Promise<void> {
  const runtime = runtimes.get(discussionId);
  if (!runtime) return;
  await runtime.stop();
  runtimes.delete(discussionId);
}

export function pauseDiscussionRuntime(discussionId: string): void {
  runtimes.get(discussionId)?.pause();
}

export function resumeDiscussionRuntime(discussionId: string): void {
  runtimes.get(discussionId)?.resume();
}

export function isRuntimeActive(discussionId: string): boolean {
  return runtimes.has(discussionId);
}

export function activeRuntimeCount(): number {
  return runtimes.size;
}

export function resetRuntimes(): void {
  for (const runtime of runtimes.values()) {
    void runtime.stop();
  }
  runtimes.clear();
}
