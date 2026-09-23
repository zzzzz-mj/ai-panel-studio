import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/index';
import { seedDatabase } from '../../src/db/seed';
import { freshRepo, teardown, waitFor } from '../helpers';

/**
 * 端到端测试：完全走 HTTP，覆盖「建议题 → 生成阵容 → 微调 → 开始 → 实时推进 → 收尾」主链路。
 *
 * 这里刻意不 mock 引擎（vitest.config.ts 已强制 LLM_MOCK=true），
 * 所以跑的是与生产同一套编排代码，只是模型换成了离线确定性实现。
 */

const app = createApp();

let server: Server | null = null;

beforeEach(() => {
  freshRepo();
});

afterEach(async () => {
  teardown();
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = null;
  }
});

afterAll(() => {
  teardown();
});

async function createAndPrepare(topic: string, expertCount = 4): Promise<string> {
  const created = await request(app).post('/api/discussions').send({ topic, expertCount });
  expect(created.status).toBe(201);
  const id = created.body.id as string;

  const panel = await request(app).post(`/api/discussions/${id}/panel`).send({});
  expect(panel.status).toBe(201);
  return id;
}

async function statusOf(id: string): Promise<string> {
  const res = await request(app).get(`/api/discussions/${id}`);
  return res.body.status as string;
}

describe('E2E：健康检查与样例数据', () => {
  it('健康检查暴露模型信息但绝不暴露密钥', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.llm.mock).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/api[-_]?key|sk-/i);
  });

  it('预置议题库提供 5 条以上带嘉宾阵容的样例', async () => {
    // 预置议题由 db:seed 物化，这里显式跑一次，保证用例不依赖执行顺序。
    seedDatabase();
    const res = await request(app).get('/api/preset-topics');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(5);
    for (const preset of res.body.items) {
      expect(preset.topic).toBeTruthy();
      expect(preset.suggestedPanel.length).toBeGreaterThanOrEqual(4);
      expect(preset.suggestedPanel[0].stance).toBeTruthy();
    }
  });

  it('首页列表返回讨论摘要与配色', async () => {
    await createAndPrepare('远程办公是否会削弱团队的创新能力？');
    const res = await request(app).get('/api/discussions?status=all');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
    const item = res.body.items[0];
    expect(item.panelistCount).toBe(5);
    expect(item.palette).toHaveLength(5);
  });
});

describe('E2E：参数校验与状态机', () => {
  it('议题过短被拒绝', async () => {
    const res = await request(app).post('/api/discussions').send({ topic: '短' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('专家人数超出 2-6 被拒绝', async () => {
    const res = await request(app).post('/api/discussions').send({ topic: '一个合法的议题', expertCount: 12 });
    expect(res.status).toBe(400);
  });

  it('未生成阵容就启动讨论会被拒绝', async () => {
    const created = await request(app).post('/api/discussions').send({ topic: '一个合法的议题' });
    const res = await request(app).post(`/api/discussions/${created.body.id}/start`);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('阵容');
  });

  it('不存在的讨论返回 404', async () => {
    const res = await request(app).get('/api/discussions/d-not-exist');
    expect(res.status).toBe(404);
  });

  it('讨论开始后不允许再改阵容', async () => {
    const id = await createAndPrepare('一个合法的议题');
    await request(app).post(`/api/discussions/${id}/start`);
    const detail = await request(app).get(`/api/discussions/${id}`);
    const panelistId = detail.body.panelists[1].id as string;

    const res = await request(app).patch(`/api/discussions/${id}/panel/${panelistId}`).send({ name: '新名字' });
    expect(res.status).toBe(409);

    await request(app).post(`/api/discussions/${id}/stop`);
  });
});

describe('E2E：主链路（建议题 → 阵容 → 开始 → 收尾）', () => {
  it('完整跑完一场讨论，并产出 transcript / 共识分歧 / 自然语言总结', async () => {
    const id = await createAndPrepare('AI 是否会取代中小学教师？', 4);

    // 阵容：1 主持人 + 4 专家，颜色唯一
    const ready = await request(app).get(`/api/discussions/${id}`);
    expect(ready.body.status).toBe('ready');
    expect(ready.body.panelists).toHaveLength(5);
    expect(ready.body.panelists[0].role).toBe('host');
    const colors = ready.body.panelists.map((p: { color: string }) => p.color);
    expect(new Set(colors).size).toBe(colors.length);

    // 用户确认前微调一位嘉宾
    const target = ready.body.panelists[1].id as string;
    const patched = await request(app)
      .patch(`/api/discussions/${id}/panel/${target}`)
      .send({ title: '教育技术学教授', color: '#5FB3C9' });
    expect(patched.status).toBe(200);
    expect(patched.body.title).toBe('教育技术学教授');

    // 开始
    const started = await request(app).post(`/api/discussions/${id}/start`);
    expect(started.status).toBe(200);
    expect(started.body.status).toBe('live');

    // 等待引擎自然跑完
    await waitFor(() => statusOf(id), (s) => s === 'ended');

    const detail = await request(app).get(`/api/discussions/${id}`);
    const body = detail.body;

    // 1) transcript 有内容，且主持人开场在最前、总结在最后
    expect(body.transcript.length).toBeGreaterThan(8);
    expect(body.transcript[0].intent).toBe('open');
    expect(body.transcript.at(-1).intent).toBe('summary');

    // 2) 每位嘉宾都至少发过言（首轮全员表态）
    const speakers = new Set(body.transcript.map((t: { panelistId: string }) => t.panelistId));
    expect(speakers.size).toBe(5);

    // 3) 每次发言都是 1-2 句（主持人收尾总结按设计是整段，不在此约束内）
    for (const entry of body.transcript) {
      if (entry.intent === 'summary') continue;
      const sentences = entry.content.split(/[。！？]/).filter((s: string) => s.trim().length > 0);
      expect(sentences.length).toBeLessThanOrEqual(2);
      expect(entry.content.length).toBeLessThanOrEqual(200);
    }

    // 4) 共识与分歧都在讨论过程中被提炼出来了
    expect(body.insights.filter((i: { kind: string }) => i.kind === 'consensus').length).toBeGreaterThan(0);
    expect(body.insights.filter((i: { kind: string }) => i.kind === 'divergence').length).toBeGreaterThan(0);

    // 5) 总结是自然语言，页面上不会出现 JSON 原文
    expect(typeof body.summary).toBe('string');
    expect(body.summary).not.toContain('{');
    expect(body.summary).not.toContain('```');
    expect(body.summary.length).toBeGreaterThan(80);

    // 6) transcript 里不出现「举手 / 抢答」这类内部事件
    for (const entry of body.transcript) {
      expect(entry.content).not.toMatch(/举手|抢答|轮到我/);
      expect(['open', 'question', 'bridge', 'claim', 'rebuttal', 'supplement', 'agree', 'summary']).toContain(entry.intent);
    }
  });

  it('手动结束讨论时，总结一定在响应返回前就已生成', async () => {
    const id = await createAndPrepare('短视频是否正在重塑年轻人的注意力结构？', 3);
    await request(app).post(`/api/discussions/${id}/start`);
    await new Promise((resolve) => setTimeout(resolve, 60));

    const stopped = await request(app).post(`/api/discussions/${id}/stop`);
    expect(stopped.status).toBe(200);
    expect(stopped.body.status).toBe('ended');
    expect(typeof stopped.body.summary).toBe('string');
    expect(stopped.body.summary.length).toBeGreaterThan(40);
  });

  it('暂停后不再推进，继续后恢复', async () => {
    const id = await createAndPrepare('开源项目的商业化是否必然以社区信任为代价？', 3);
    await request(app).post(`/api/discussions/${id}/start`);

    const paused = await request(app).post(`/api/discussions/${id}/pause`);
    expect(paused.body.status).toBe('paused');

    const before = await request(app).get(`/api/discussions/${id}`);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const after = await request(app).get(`/api/discussions/${id}`);
    expect(after.body.transcript.length).toBe(before.body.transcript.length);

    const resumed = await request(app).post(`/api/discussions/${id}/resume`);
    expect(resumed.body.status).toBe('live');

    await request(app).post(`/api/discussions/${id}/stop`);
  });
});

describe('E2E：多讨论并行隔离', () => {
  it('两场同时进行的讨论，状态、发言与共识互不串台', async () => {
    const idA = await createAndPrepare('议题 A：四天工作制应该被立法强制推行吗？', 3);
    const idB = await createAndPrepare('议题 B：AI 生成内容的版权应该归属于谁？', 4);

    await Promise.all([
      request(app).post(`/api/discussions/${idA}/start`),
      request(app).post(`/api/discussions/${idB}/start`),
    ]);

    await waitFor(
      async () => `${await statusOf(idA)}|${await statusOf(idB)}`,
      (s) => s === 'ended|ended',
    );

    const [a, b] = await Promise.all([
      request(app).get(`/api/discussions/${idA}`),
      request(app).get(`/api/discussions/${idB}`),
    ]);

    expect(a.body.topic).toContain('议题 A');
    expect(b.body.topic).toContain('议题 B');
    expect(a.body.panelists).toHaveLength(4);
    expect(b.body.panelists).toHaveLength(5);

    // 两边的嘉宾 id 集合完全不相交
    const idsA = new Set(a.body.panelists.map((p: { id: string }) => p.id));
    for (const panelist of b.body.panelists) {
      expect(idsA.has(panelist.id)).toBe(false);
    }

    // 两边的发言只引用自己讨论内的嘉宾
    for (const entry of a.body.transcript) {
      expect(entry.discussionId).toBe(idA);
      expect(idsA.has(entry.panelistId)).toBe(true);
    }

    // 共识 / 分歧也各自带上正确的 discussionId
    expect(a.body.insights.every((i: { discussionId: string }) => i.discussionId === idA)).toBe(true);
    expect(b.body.insights.every((i: { discussionId: string }) => i.discussionId === idB)).toBe(true);

    // 总结各自包含自己的议题
    expect(a.body.summary).toContain('四天工作制');
    expect(b.body.summary).toContain('版权');
  });
});

describe('E2E：SSE 实时流', () => {
  it('连接后先收到 snapshot，再收到增量事件，且带 seq 游标', async () => {
    const id = await createAndPrepare('AI 是否会取代中小学教师？', 3);

    server = app.listen(0);
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}/api/discussions/${id}/stream`, {
      signal: controller.signal,
    });
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const events: Array<{ type: string; seq: number }> = [];

    // 先连上，再开始讨论，确保能观察到实时事件
    const startedAt = Date.now();
    const readTask = (async () => {
      while (Date.now() - startedAt < 12_000) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const type = /^event: (.+)$/m.exec(frame)?.[1];
          const seq = Number.parseInt(/^id: (\d+)$/m.exec(frame)?.[1] ?? '0', 10);
          if (type) events.push({ type, seq });
        }
        if (events.some((e) => e.type === 'summary.final')) break;
      }
    })();

    await request(app).post(`/api/discussions/${id}/start`);
    await readTask;
    controller.abort();

    expect(events[0]?.type).toBe('snapshot');
    expect(events.some((e) => e.type === 'discussion.status')).toBe(true);
    expect(events.some((e) => e.type === 'transcript.append')).toBe(true);
    expect(events.some((e) => e.type === 'panelist.status')).toBe(true);
    expect(events.some((e) => e.type === 'insight.upsert')).toBe(true);
    expect(events.some((e) => e.type === 'summary.final')).toBe(true);

    // seq 单调不减，客户端可据此做断线续传
    const seqs = events.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
  });
});
