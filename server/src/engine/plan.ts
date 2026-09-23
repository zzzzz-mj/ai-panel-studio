import type { Phase, SpeakDecision } from '../domain/types';

/**
 * 讨论节奏的纯逻辑。
 *
 * 单独抽出来是为了可测：这些函数决定了「讨论怎么推进」「谁先发言」，
 * 一旦出错整场讨论的观感就会崩（比如退化成机械轮流发言）。
 */

/** 一场讨论的固定轮数：铺开 → 交锋 → 交锋 → 收敛。 */
export const TOTAL_ROUNDS = 4;

const PHASE_BY_ROUND: Record<number, Phase> = {
  1: 'exploration',
  2: 'conflict',
  3: 'conflict',
  4: 'convergence',
};

export function phaseForRound(round: number): Phase {
  return PHASE_BY_ROUND[round] ?? 'convergence';
}

export function isFinalRound(round: number): boolean {
  return round >= TOTAL_ROUNDS;
}

/**
 * 把「抢答意愿」排成发言顺序。
 *
 * 规则：
 * 1. 不想发言的直接剔除；
 * 2. 反驳（rebuttal）优先于补充（supplement）优先于亮主张（claim）——
 *    这直接对应产品要求里的「举手 / 抢答 / 补充 / 反驳」优先级；
 * 3. 同优先级按 urgency 降序；
 * 4. 同一轮内每个人最多发言一次（去重）。
 *
 * 返回排好序的嘉宾 id 列表。
 */
export function orderSpeakers(
  decisions: Array<{ panelistId: string; decision: SpeakDecision }>,
): string[] {
  const intentWeight: Record<SpeakDecision['intent'], number> = {
    rebuttal: 4,
    supplement: 3,
    claim: 2,
    agree: 1,
  };

  const seen = new Set<string>();
  return decisions
    .filter((item) => item.decision.wantsToSpeak)
    .filter((item) => {
      if (seen.has(item.panelistId)) return false;
      seen.add(item.panelistId);
      return true;
    })
    .sort((a, b) => {
      const weightDiff = intentWeight[b.decision.intent] - intentWeight[a.decision.intent];
      if (weightDiff !== 0) return weightDiff;
      return b.decision.urgency - a.decision.urgency;
    })
    .map((item) => item.panelistId);
}

/**
 * 每轮最少发言人数。若所有人都选择沉默（模型判断"没有增量"），
 * 由引擎按 urgency 兜底拉人，避免出现"一轮里没人说话"的冷场。
 */
export const MIN_SPEAKERS_PER_ROUND = 2;
