import { describe, expect, it } from 'vitest';
import { MockEngine, mockCatalog } from '../../src/llm/mock';
import type { PanelistCard, SpeakRequest, SynthesisRequest } from '../../src/llm/types';

const engine = new MockEngine();

function card(name: string, title: string, role: 'host' | 'expert' = 'expert'): PanelistCard {
  return { id: `p-${name}`, name, title, role, stance: '立场', bio: '简介', focus: null };
}

function speakRequest(overrides: Partial<SpeakRequest> = {}): SpeakRequest {
  return {
    topic: '远程办公是否会削弱团队的创新能力？',
    background: null,
    phase: 'conflict',
    round: 2,
    self: card('专家甲', '技术战略研究者'),
    spokeThisRound: [],
    recentTurns: [],
    insights: [],
    ...overrides,
  };
}

describe('离线引擎：阵容生成', () => {
  it('生成 1 位主持人 + N 位专家', async () => {
    const draft = await engine.generatePanel({
      topic: 'AI 是否会取代中小学教师？',
      background: null,
      expertCount: 4,
    });
    expect(draft.host.name).toBeTruthy();
    expect(draft.host.title).toBe('圆桌主持人');
    expect(draft.experts).toHaveLength(4);
    expect(draft.experts.every((e) => e.name && e.title && e.stance && e.bio)).toBe(true);
  });

  it('确定性：同样的输入产生完全相同的阵容', async () => {
    const input = { topic: '四天工作制应该被立法强制推行吗？', background: null, expertCount: 4 };
    const first = await engine.generatePanel(input);
    const second = await engine.generatePanel(input);
    expect(first).toEqual(second);
  });

  it('不同议题产生不同的阵容组合', async () => {
    const a = await engine.generatePanel({ topic: '议题甲', background: null, expertCount: 4 });
    const b = await engine.generatePanel({ topic: '议题乙', background: null, expertCount: 4 });
    expect(a.experts.map((e) => e.title)).not.toEqual(b.experts.map((e) => e.title));
  });

  it('阵容内的立场不重复，保证有可辩论的张力', async () => {
    const draft = await engine.generatePanel({ topic: '任意议题', background: null, expertCount: 5 });
    const stances = draft.experts.map((e) => e.stance);
    expect(new Set(stances).size).toBe(stances.length);
  });
});

describe('离线引擎：发言决策', () => {
  it('确定性：同一嘉宾在同一轮重复询问得到相同决策', async () => {
    const first = await engine.decideSpeak(speakRequest());
    const second = await engine.decideSpeak(speakRequest());
    expect(first).toEqual(second);
  });

  it('本轮已发过言的嘉宾不再抢答', async () => {
    const request = speakRequest();
    const result = await engine.decideSpeak({ ...request, spokeThisRound: [request.self.id] });
    expect(result.wantsToSpeak).toBe(false);
  });

  it('首轮让所有嘉宾都亮明立场', async () => {
    const result = await engine.decideSpeak(speakRequest({ round: 1, phase: 'exploration' }));
    expect(result.wantsToSpeak).toBe(true);
    expect(result.focus).toBeTruthy();
  });

  it('focus 是对外关注点，不是推理过程', async () => {
    const result = await engine.decideSpeak(speakRequest({ round: 1 }));
    const archetype = mockCatalog.archetypes.find((a) => a.title === '技术战略研究者');
    expect(archetype?.focuses).toContain(result.focus);
  });
});

describe('离线引擎：发言生成', () => {
  it('输出 1-2 句中文，且带上被回应的发言人姓名', async () => {
    const request = speakRequest({
      recentTurns: [{ speakerName: '罗青野', speakerTitle: '厂长', intent: 'claim', content: '前一句。', round: 1 }],
    });
    const text = await engine.composeUtterance({
      ...request,
      decision: { wantsToSpeak: true, intent: 'rebuttal', urgency: 80, focus: '成本口径' },
      roundSoFar: [],
    });
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('罗青野');
    expect(text.split(/[。！？]/).filter(Boolean).length).toBeLessThanOrEqual(2);
  });
});

/** 覆盖全部 6 个立场原型，这样共识 / 分歧池里的组合条件都能被满足。 */
const panel: PanelistCard[] = [
  card('陈启明', '技术战略研究者'),
  card('沈亦舟', '技术风险研究员'),
  card('梁思勉', '产业经济学者'),
  card('方叙白', '一线实践者'),
  card('苏怀瑾', '科技伦理学者'),
  card('秦望岳', '制度与历史研究者'),
];

function synthesisRequest(round: number): SynthesisRequest {
  return {
    topic: '远程办公是否会削弱团队的创新能力？',
    background: null,
    round,
    panel,
    transcript: [],
    previous: [],
  };
}

describe('离线引擎：共识 / 分歧提炼', () => {
  it('随轮次推进，清单逐步变长（体现实时增量更新）', async () => {
    const early = await engine.synthesize(synthesisRequest(1));
    const late = await engine.synthesize(synthesisRequest(4));
    expect(early.consensus.length).toBeGreaterThan(0);
    expect(late.consensus.length).toBeGreaterThan(early.consensus.length);
  });

  it('支持者只来自当前阵容，且分歧带张力描述', async () => {
    const result = await engine.synthesize(synthesisRequest(4));
    const names = new Set(panel.map((p) => p.name));
    for (const item of result.consensus) {
      expect(item.supporterNames.length).toBeGreaterThanOrEqual(2);
      for (const name of item.supporterNames) expect(names.has(name)).toBe(true);
    }
    for (const item of result.divergence) {
      expect(item.tension).toBeTruthy();
      for (const name of item.supporterNames) expect(names.has(name)).toBe(true);
    }
  });

  it('statement 里嵌入了真实议题，不是通用空话', async () => {
    const result = await engine.synthesize(synthesisRequest(4));
    expect(result.consensus[0]?.statement).toContain('远程办公是否会削弱团队的创新能力？');
  });
});

describe('离线引擎：主持人总结', () => {
  it('输出自然语言，且不含 JSON 结构', async () => {
    const summary = await engine.composeSummary({
      topic: '四天工作制应该被立法强制推行吗？',
      background: null,
      panel: panel.map((p) => ({ ...p, role: 'expert' as const })),
      transcript: [
        {
          speakerName: '陈启明',
          speakerTitle: '技术战略研究者',
          intent: 'claim',
          content: '现有试点的样本自选择问题很严重，不能直接拿来支撑普遍立法。',
          round: 1,
        },
        {
          speakerName: '沈亦舟',
          speakerTitle: '技术风险研究员',
          intent: 'rebuttal',
          content: '样本偏差确实存在，但不立法的话，这项制度只会变成高议价能力岗位的专属福利。',
          round: 2,
        },
      ],
      insights: [
        { kind: 'consensus', statement: '成本被低估', supporterNames: ['陈启明', '梁思勉'], tension: null },
        { kind: 'divergence', statement: '是否先行试点', supporterNames: ['陈启明', '沈亦舟'], tension: '退路 vs 试错' },
      ],
    });

    expect(summary).toContain('四天工作制应该被立法强制推行吗？');
    expect(summary).not.toContain('{');
    expect(summary).not.toContain('```');
    expect(summary.length).toBeGreaterThan(100);
  });
});
