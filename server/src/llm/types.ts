import type {
  InsightKind,
  Intent,
  PanelDraft,
  PanelistRole,
  Phase,
  SpeakDecision,
  SynthesisResult,
} from '../domain/types';

/**
 * 引擎层与「模型」之间的输入契约。
 *
 * 这一层刻意只暴露**已裁剪过的上下文**：每位嘉宾拿到的不是完整 transcript，
 * 而是「人设卡 + 最近若干轮 + 当前共识分歧板」。这是控制 token 增长、
 * 抑制幻觉的主要手段（见 docs/WORKFLOW.md 的上下文管理一节）。
 */

/** 嘉宾人设卡：模型扮演某个角色时能看到的最小必要信息。 */
export interface PanelistCard {
  id: string;
  name: string;
  title: string;
  role: PanelistRole;
  stance: string;
  bio: string;
  focus: string | null;
}

/** 裁剪后的一条历史发言。 */
export interface TurnView {
  speakerName: string;
  speakerTitle: string;
  intent: Intent;
  content: string;
  round: number;
}

/** 裁剪后的共识 / 分歧条目。 */
export interface InsightView {
  kind: InsightKind;
  statement: string;
  supporterNames: string[];
  tension: string | null;
}

/** 生成阵容的请求。 */
export interface PanelRequest {
  topic: string;
  background: string | null;
  expertCount: number;
}

/** 决定「谁想发言」的请求。 */
export interface SpeakRequest {
  topic: string;
  background: string | null;
  phase: Phase;
  round: number;
  self: PanelistCard;
  /** 本轮已经发过言的嘉宾 id，用于避免同一轮反复抢答 */
  spokeThisRound: string[];
  recentTurns: TurnView[];
  insights: InsightView[];
}

/** 生成一次具体发言的请求。 */
export interface UtteranceRequest extends SpeakRequest {
  decision: SpeakDecision;
  /** 本轮此前已产生的发言，用来保证「不重复别人刚说过的话」 */
  roundSoFar: TurnView[];
}

/** 提炼共识 / 分歧的请求。 */
export interface SynthesisRequest {
  topic: string;
  background: string | null;
  round: number;
  panel: PanelistCard[];
  transcript: TurnView[];
  previous: InsightView[];
}

/** 主持人收尾总结的请求。 */
export interface SummaryRequest {
  topic: string;
  background: string | null;
  panel: PanelistCard[];
  transcript: TurnView[];
  insights: InsightView[];
}

/** 主持人开场 / 抛问的请求。 */
export interface HostCueRequest {
  topic: string;
  background: string | null;
  phase: Phase;
  round: number;
  /** opening：开场白；question：向某位嘉宾追问；bridge：串联过渡 */
  kind: 'opening' | 'question' | 'bridge';
  host: PanelistCard;
  panel: PanelistCard[];
  target?: PanelistCard;
  recentTurns: TurnView[];
  insights: InsightView[];
}

/**
 * 讨论引擎依赖的「模型能力」抽象。
 *
 * 真实实现走 OpenAI 兼容协议；离线实现走确定性规则引擎。
 * 引擎本身完全不知道当前是哪一种 —— 这是能零配置演示、也能被测试的前提。
 */
export interface LlmEngine {
  readonly mock: boolean;
  readonly model: string;
  generatePanel(request: PanelRequest): Promise<PanelDraft>;
  hostCue(request: HostCueRequest): Promise<string>;
  decideSpeak(request: SpeakRequest): Promise<SpeakDecision>;
  composeUtterance(request: UtteranceRequest): Promise<string>;
  synthesize(request: SynthesisRequest): Promise<SynthesisResult>;
  composeSummary(request: SummaryRequest): Promise<string>;
}
