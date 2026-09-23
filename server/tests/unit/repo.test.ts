import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Repo } from '../../src/db/repo';
import { freshRepo, teardown } from '../helpers';
import { HOST_COLOR } from '../../src/services/panelService';
import { pickColor } from '../../src/util/palette';

let repo: Repo;

beforeEach(() => {
  repo = freshRepo().repo;
});

afterEach(teardown);

function makeDiscussion(topic = '测试议题'): string {
  const discussion = repo.createDiscussion({ topic, background: null, expertCount: 3, maxTurns: 24 });
  repo.replacePanelists(discussion.id, [
    { role: 'host', name: '主持甲', title: '主持人', org: null, stance: 's', bio: 'b', color: HOST_COLOR, orderIndex: 0 },
    { role: 'expert', name: '专家乙', title: '学者', org: null, stance: 's', bio: 'b', color: pickColor(0), orderIndex: 1 },
    { role: 'expert', name: '专家丙', title: '工程师', org: null, stance: 's', bio: 'b', color: pickColor(1), orderIndex: 2 },
  ]);
  return discussion.id;
}

describe('数据层：讨论生命周期', () => {
  it('新建讨论处于 draft 状态且轮次为 0', () => {
    const id = makeDiscussion();
    const discussion = repo.getDiscussion(id);
    expect(discussion?.status).toBe('draft');
    expect(discussion?.round).toBe(0);
    expect(discussion?.phase).toBe('opening');
  });

  it('阵容按席位顺序返回，主持人在首位', () => {
    const id = makeDiscussion();
    const panelists = repo.getPanelists(id);
    expect(panelists).toHaveLength(3);
    expect(panelists[0]?.role).toBe('host');
    expect(panelists.map((p) => p.orderIndex)).toEqual([0, 1, 2]);
  });

  it('删除讨论会级联清掉嘉宾、发言与洞察', () => {
    const id = makeDiscussion();
    const panelistId = repo.getPanelists(id)[1]!.id;
    repo.appendTranscript(id, { panelistId, round: 1, phase: 'exploration', intent: 'claim', content: '一句话。' });
    repo.reconcileInsights(id, 1, { consensus: [{ statement: '共识一', supporterNames: ['专家乙', '专家丙'] }], divergence: [] });

    expect(repo.deleteDiscussion(id)).toBe(true);
    expect(repo.getDiscussion(id)).toBeNull();
    expect(repo.getPanelists(id)).toHaveLength(0);
    expect(repo.getTranscript(id)).toHaveLength(0);
    expect(repo.getInsights(id)).toHaveLength(0);
  });
});

describe('数据层：seq 与事件流', () => {
  it('发言与事件共享同一个单调递增的 seq', () => {
    const id = makeDiscussion();
    const panelists = repo.getPanelists(id);
    const first = repo.appendTranscript(id, {
      panelistId: panelists[1]!.id,
      round: 1,
      phase: 'exploration',
      intent: 'claim',
      content: '第一句。',
    });
    const second = repo.appendTranscript(id, {
      panelistId: panelists[2]!.id,
      round: 1,
      phase: 'exploration',
      intent: 'rebuttal',
      content: '第二句。',
    });

    expect(first.entry.seq).toBe(1);
    expect(first.event.seq).toBe(1);
    expect(second.entry.seq).toBe(2);
    expect(repo.lastSeq(id)).toBe(2);
  });

  it('事件回放时把 transcript.append 还原成完整发言对象', () => {
    const id = makeDiscussion();
    const panelistId = repo.getPanelists(id)[1]!.id;
    repo.appendTranscript(id, {
      panelistId,
      round: 1,
      phase: 'exploration',
      intent: 'claim',
      content: '回放内容。',
    });

    const events = repo.getEvents(id);
    const append = events.find((e) => e.type === 'transcript.append');
    const payload = append?.payload as { entry?: { content: string } };
    expect(payload.entry?.content).toBe('回放内容。');
  });

  it('不同讨论的 seq 互相独立（隔离性）', () => {
    const a = makeDiscussion('议题 A');
    const b = makeDiscussion('议题 B');
    const pa = repo.getPanelists(a)[1]!.id;
    const pb = repo.getPanelists(b)[1]!.id;

    repo.appendTranscript(a, { panelistId: pa, round: 1, phase: 'exploration', intent: 'claim', content: 'A1。' });
    repo.appendTranscript(a, { panelistId: pa, round: 1, phase: 'exploration', intent: 'claim', content: 'A2。' });
    repo.appendTranscript(b, { panelistId: pb, round: 1, phase: 'exploration', intent: 'claim', content: 'B1。' });

    expect(repo.lastSeq(a)).toBe(2);
    expect(repo.lastSeq(b)).toBe(1);
    expect(repo.getTranscript(b).map((e) => e.content)).toEqual(['B1。']);
  });
});

describe('数据层：共识 / 分歧对账', () => {
  it('首次提炼会新增条目，并解析支持者姓名到 id', () => {
    const id = makeDiscussion();
    const changes = repo.reconcileInsights(id, 1, {
      consensus: [{ statement: '成本被系统性低估', supporterNames: ['专家乙', '专家丙'] }],
      divergence: [{ statement: '是否应该先行试点', supporterNames: ['专家乙'], tension: '退路 vs 试错' }],
    });

    expect(changes).toHaveLength(2);
    expect(changes.every((c) => c.isNew)).toBe(true);

    const insights = repo.getInsights(id);
    const consensus = insights.find((i) => i.kind === 'consensus');
    expect(consensus?.statement).toBe('成本被系统性低估');
    expect(consensus?.supporterIds).toHaveLength(2);
    expect(consensus?.status).toBe('stable');

    const divergence = insights.find((i) => i.kind === 'divergence');
    expect(divergence?.tension).toBe('退路 vs 试错');
    expect(divergence?.status).toBe('emerging');
  });

  it('同一 statement 再次出现时更新而不是新增（避免刷屏）', () => {
    const id = makeDiscussion();
    repo.reconcileInsights(id, 1, {
      consensus: [{ statement: '成本被系统性低估', supporterNames: ['专家乙'] }],
      divergence: [],
    });
    repo.reconcileInsights(id, 2, {
      consensus: [{ statement: '成本被系统性低估。', supporterNames: ['专家丙'] }],
      divergence: [],
    });

    const insights = repo.getInsights(id);
    expect(insights).toHaveLength(1);
    expect(insights[0]?.supporterIds).toHaveLength(2);
  });

  it('本轮未再出现的 emerging 条目会被降级为 stable', () => {
    const id = makeDiscussion();
    repo.reconcileInsights(id, 1, {
      consensus: [],
      divergence: [{ statement: '悬而未决的分歧', supporterNames: ['专家乙'], tension: 't' }],
    });
    expect(repo.getInsights(id)[0]?.status).toBe('emerging');

    repo.reconcileInsights(id, 2, { consensus: [], divergence: [] });
    expect(repo.getInsights(id)[0]?.status).toBe('stable');
  });

  it('支持者姓名不在名单内时被忽略，不会写入脏 id', () => {
    const id = makeDiscussion();
    repo.reconcileInsights(id, 1, {
      consensus: [{ statement: '某个共识', supporterNames: ['不存在的名字', '专家乙'] }],
      divergence: [],
    });
    expect(repo.getInsights(id)[0]?.supporterIds).toHaveLength(1);
  });
});

describe('数据层：首页列表聚合', () => {
  it('列表项带上嘉宾配色与统计数字，且不产生额外查询', () => {
    const id = makeDiscussion('列表议题');
    const panelistId = repo.getPanelists(id)[1]!.id;
    repo.appendTranscript(id, { panelistId, round: 1, phase: 'exploration', intent: 'claim', content: '最新一条发言。' });
    repo.reconcileInsights(id, 1, {
      consensus: [{ statement: '共识', supporterNames: ['专家乙', '专家丙'] }],
      divergence: [{ statement: '分歧', supporterNames: ['专家乙'], tension: 't' }],
    });

    const [summary] = repo.listSummaries({ status: 'all', limit: 10 });
    expect(summary?.topic).toBe('列表议题');
    expect(summary?.panelistCount).toBe(3);
    expect(summary?.entryCount).toBe(1);
    expect(summary?.consensusCount).toBe(1);
    expect(summary?.divergenceCount).toBe(1);
    expect(summary?.preview).toBe('最新一条发言。');
    expect(summary?.palette).toHaveLength(3);
    expect(summary?.palette[0]).toBe(HOST_COLOR);
  });
});
