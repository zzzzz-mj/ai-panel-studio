import { describe, expect, it } from 'vitest';
import { MIN_SPEAKERS_PER_ROUND, TOTAL_ROUNDS, isFinalRound, orderSpeakers, phaseForRound } from '../../src/engine/plan';
import type { SpeakDecision } from '../../src/domain/types';

function decision(partial: Partial<SpeakDecision> & { wantsToSpeak?: boolean }): SpeakDecision {
  return {
    wantsToSpeak: partial.wantsToSpeak ?? true,
    intent: partial.intent ?? 'claim',
    urgency: partial.urgency ?? 50,
    focus: partial.focus ?? '',
  };
}

describe('讨论节奏：阶段推进', () => {
  it('把轮次映射到正确的讨论阶段', () => {
    expect(phaseForRound(1)).toBe('exploration');
    expect(phaseForRound(2)).toBe('conflict');
    expect(phaseForRound(3)).toBe('conflict');
    expect(phaseForRound(4)).toBe('convergence');
  });

  it('超出固定轮数后收敛到 convergence，不会越界', () => {
    expect(phaseForRound(99)).toBe('convergence');
  });

  it('只把第 4 轮认定为最终轮', () => {
    expect(isFinalRound(TOTAL_ROUNDS - 1)).toBe(false);
    expect(isFinalRound(TOTAL_ROUNDS)).toBe(true);
  });
});

describe('发言排序：避免退化成机械轮流发言', () => {
  it('反驳优先于补充，补充优先于亮主张，附和最后', () => {
    const order = orderSpeakers([
      { panelistId: 'p-claim', decision: decision({ intent: 'claim', urgency: 100 }) },
      { panelistId: 'p-agree', decision: decision({ intent: 'agree', urgency: 100 }) },
      { panelistId: 'p-rebut', decision: decision({ intent: 'rebuttal', urgency: 10 }) },
      { panelistId: 'p-supp', decision: decision({ intent: 'supplement', urgency: 90 }) },
    ]);
    expect(order).toEqual(['p-rebut', 'p-supp', 'p-claim', 'p-agree']);
  });

  it('同优先级按 urgency 降序', () => {
    const order = orderSpeakers([
      { panelistId: 'low', decision: decision({ intent: 'rebuttal', urgency: 20 }) },
      { panelistId: 'high', decision: decision({ intent: 'rebuttal', urgency: 80 }) },
      { panelistId: 'mid', decision: decision({ intent: 'rebuttal', urgency: 50 }) },
    ]);
    expect(order).toEqual(['high', 'mid', 'low']);
  });

  it('剔除不想发言的嘉宾', () => {
    const order = orderSpeakers([
      { panelistId: 'silent', decision: decision({ wantsToSpeak: false, urgency: 99 }) },
      { panelistId: 'talker', decision: decision({ urgency: 1 }) },
    ]);
    expect(order).toEqual(['talker']);
  });

  it('同一轮内同一个人只出现一次', () => {
    const order = orderSpeakers([
      { panelistId: 'dup', decision: decision({ intent: 'rebuttal', urgency: 90 }) },
      { panelistId: 'dup', decision: decision({ intent: 'rebuttal', urgency: 10 }) },
    ]);
    expect(order).toEqual(['dup']);
  });

  it('全员沉默时返回空数组，交由引擎按 urgency 兜底', () => {
    const order = orderSpeakers([
      { panelistId: 'a', decision: decision({ wantsToSpeak: false }) },
      { panelistId: 'b', decision: decision({ wantsToSpeak: false }) },
    ]);
    expect(order).toHaveLength(0);
    expect(order.length).toBeLessThan(MIN_SPEAKERS_PER_ROUND);
  });
});
