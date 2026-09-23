import { describe, expect, it } from 'vitest';
import {
  CONTEXT_WINDOW,
  buildInsightViews,
  buildRecentTurns,
  expertsOf,
  hostOf,
  speakersInRound,
} from '../../src/engine/context';
import type { Insight, Panelist, TranscriptEntry } from '../../src/domain/types';

function panelist(id: string, name: string, role: 'host' | 'expert'): Panelist {
  return {
    id,
    discussionId: 'd-1',
    role,
    name,
    title: '头衔',
    org: null,
    stance: '立场',
    bio: '简介',
    color: '#000000',
    status: 'idle',
    focus: null,
    orderIndex: 0,
  };
}

function entry(id: string, panelistId: string, seq: number, round: number, content: string): TranscriptEntry {
  return {
    id,
    discussionId: 'd-1',
    panelistId,
    seq,
    round,
    phase: 'exploration',
    intent: 'claim',
    content,
    createdAt: seq,
  };
}

describe('上下文裁剪：控制 token 增长的核心', () => {
  const panel = [panelist('p-host', '主持', 'host'), panelist('p-a', '甲', 'expert'), panelist('p-b', '乙', 'expert')];

  it('只保留最近 N 条发言，而不是全量 transcript', () => {
    const transcript = Array.from({ length: 50 }, (_, i) => entry(`t-${i}`, 'p-a', i + 1, 1, `第 ${i + 1} 句。`));
    const turns = buildRecentTurns(transcript, panel);
    expect(turns).toHaveLength(CONTEXT_WINDOW.recentTurns);
    expect(turns.at(-1)?.content).toBe('第 50 句。');
  });

  it('把发言人姓名与头衔补齐到每条发言上', () => {
    const turns = buildRecentTurns([entry('t-1', 'p-b', 1, 1, '一句话。')], panel);
    expect(turns[0]).toMatchObject({ speakerName: '乙', speakerTitle: '头衔' });
  });

  it('未知发言人退化为占位名，不会抛错', () => {
    const turns = buildRecentTurns([entry('t-1', 'p-ghost', 1, 1, '一句话。')], panel);
    expect(turns[0]?.speakerName).toBe('未知');
  });

  it('共识 / 分歧把 supporterIds 还原成姓名', () => {
    const insight: Insight = {
      id: 'i-1',
      discussionId: 'd-1',
      kind: 'consensus',
      statement: '共识',
      supporterIds: ['p-a', 'p-b'],
      tension: null,
      status: 'stable',
      round: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    expect(buildInsightViews([insight], panel)[0]?.supporterNames).toEqual(['甲', '乙']);
  });

  it('能按轮次取出本轮已发言的人', () => {
    const transcript = [entry('t-1', 'p-a', 1, 1, 'a'), entry('t-2', 'p-b', 2, 2, 'b'), entry('t-3', 'p-a', 3, 2, 'c')];
    expect(speakersInRound(transcript, 2)).toEqual(['p-b', 'p-a']);
    expect(speakersInRound(transcript, 9)).toEqual([]);
  });

  it('能区分主持人与专家', () => {
    expect(expertsOf(panel).map((p) => p.id)).toEqual(['p-a', 'p-b']);
    expect(hostOf(panel)?.id).toBe('p-host');
    expect(hostOf([panel[1]!])).toBeNull();
  });
});
