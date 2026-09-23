import type { Request, Response, Router } from 'express';
import { getRepo } from '../db/repo';
import { eventBus } from '../engine/eventBus';
import type { DiscussionEvent } from '../domain/types';

/**
 * SSE 实时流。
 *
 * 连接建立后按这个顺序推送，保证「中途加入」与「断线重连」都能拿到完整且不重复的状态：
 *   1. snapshot —— 当前完整状态（含 panelists / transcript / insights）
 *   2. replay   —— seq > since 的历史事件
 *   3. live     —— 订阅事件总线，之后增量推送
 *
 * 先订阅再回放，并按 seq 去重：这样订阅与回放之间即使有事件产生也不会丢。
 */

const HEARTBEAT_MS = 15_000;

function writeEvent(res: Response, event: DiscussionEvent): void {
  res.write(`id: ${event.seq}\n`);
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

export function registerStreamRoute(router: Router): void {
  router.get('/discussions/:id/stream', (req: Request, res: Response) => {
    const discussionId = req.params.id;
    if (typeof discussionId !== 'string' || discussionId === '') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '讨论不存在' } });
      return;
    }
    const repo = getRepo();
    const detail = repo.getDetail(discussionId);

    if (!detail) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '讨论不存在' } });
      return;
    }

    const since = resolveSince(req);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    let closed = false;
    const sentSeqs = new Set<number>();

    const send = (event: DiscussionEvent): void => {
      if (closed) return;
      if (event.type !== 'snapshot' && sentSeqs.has(event.seq)) return;
      sentSeqs.add(event.seq);
      writeEvent(res, event);
    };

    // 1) 快照
    send({ seq: detail.lastSeq, type: 'snapshot', discussionId, ts: Date.now(), payload: detail });

    // 2) 先订阅再回放，避免中间产生的事件丢失
    const unsubscribe = eventBus.subscribe(discussionId, send);
    for (const event of repo.getEvents(discussionId, since)) {
      send(event);
    }

    // 3) 保活
    const heartbeat = setInterval(() => {
      send({
        seq: repo.lastSeq(discussionId),
        type: 'heartbeat',
        discussionId,
        ts: Date.now(),
        payload: {},
      });
    }, HEARTBEAT_MS);

    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    };

    req.on('close', cleanup);
    req.on('error', cleanup);
    res.on('error', cleanup);
  });
}

/** 优先用查询参数 since；否则回退到 EventSource 自动重连带的 Last-Event-ID。 */
function resolveSince(req: Request): number {
  const fromQuery = Number.parseInt(String(req.query.since ?? ''), 10);
  if (Number.isFinite(fromQuery) && fromQuery >= 0) return fromQuery;
  const fromHeader = Number.parseInt(String(req.headers['last-event-id'] ?? ''), 10);
  return Number.isFinite(fromHeader) && fromHeader >= 0 ? fromHeader : 0;
}
