import type { Insight, Panelist, TranscriptEntry } from '../domain/types';
import type { InsightView, PanelistCard, TurnView } from '../llm/types';

/**
 * 上下文裁剪。
 *
 * 这是「避免大模型幻觉 / 控制 token 无限增长」的核心手段：
 * - 每位嘉宾看到的不是完整 transcript，而是「人设卡 + 最近 N 条 + 当前共识分歧板」；
 * - 共识 / 分歧板本身是讨论状态的压缩表示，等于给模型一个滚动的长期记忆；
 * - 提炼任务给稍长的窗口（因为它需要看到足够多的发言才能判断"是否有多方认同"）。
 *
 * 所有函数都是纯函数，便于单测。
 */

export const CONTEXT_WINDOW = {
  /** 单次发言 / 决策时，模型能看到的历史发言条数 */
  recentTurns: 8,
  /** 共识提炼时，模型能看到的 transcript 条数 */
  synthesisTurns: 20,
} as const;

export function toCard(panelist: Panelist): PanelistCard {
  return {
    id: panelist.id,
    name: panelist.name,
    title: panelist.title,
    role: panelist.role,
    stance: panelist.stance,
    bio: panelist.bio,
    focus: panelist.focus,
  };
}

export function buildPanelCards(panelists: Panelist[]): PanelistCard[] {
  return panelists.map(toCard);
}

/** 把发言记录补齐发言人信息，并只保留最近 limit 条。 */
export function buildRecentTurns(
  transcript: TranscriptEntry[],
  panelists: Panelist[],
  limit: number = CONTEXT_WINDOW.recentTurns,
): TurnView[] {
  const byId = new Map(panelists.map((p) => [p.id, p]));
  return transcript.slice(-limit).map((entry) => {
    const speaker = byId.get(entry.panelistId);
    return {
      speakerName: speaker?.name ?? '未知',
      speakerTitle: speaker?.title ?? '',
      intent: entry.intent,
      content: entry.content,
      round: entry.round,
    };
  });
}

export function buildInsightViews(insights: Insight[], panelists: Panelist[]): InsightView[] {
  const nameById = new Map(panelists.map((p) => [p.id, p.name]));
  return insights.map((insight) => ({
    kind: insight.kind,
    statement: insight.statement,
    supporterNames: insight.supporterIds.map((id) => nameById.get(id) ?? '').filter(Boolean),
    tension: insight.tension,
  }));
}

/** 本轮已发言的嘉宾 id，用于避免同一轮内同一个人反复抢答。 */
export function speakersInRound(transcript: TranscriptEntry[], round: number): string[] {
  return transcript.filter((entry) => entry.round === round).map((entry) => entry.panelistId);
}

/** 仅保留专家（主持人由引擎显式调度，不参与"抢答"）。 */
export function expertsOf(panelists: Panelist[]): Panelist[] {
  return panelists.filter((p) => p.role === 'expert');
}

export function hostOf(panelists: Panelist[]): Panelist | null {
  return panelists.find((p) => p.role === 'host') ?? null;
}
