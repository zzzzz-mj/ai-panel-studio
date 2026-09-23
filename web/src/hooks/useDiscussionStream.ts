import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type {
  DiscussionDetail,
  DiscussionEvent,
  DiscussionStatusPayload,
  Insight,
  InsightUpsertPayload,
  PanelistStatusPayload,
  SummaryFinalPayload,
  TranscriptAppendPayload,
  TranscriptEntry,
} from '../api/types';

/**
 * 单场讨论的实时订阅。
 *
 * 分工很明确：
 *   - 连接建立后先收 snapshot（完整状态），因此「中途加入」不需要额外的详情请求；
 *   - 之后按 seq 增量合并，transcript / insight 都按 id 幂等 upsert，
 *     所以 EventSource 自动重连造成的重复投递不会产生重复内容；
 *   - 每个讨论一个 EventSource，互不共享，这是多讨论并行隔离在前端的落点。
 */

const EVENT_TYPES = [
  'snapshot',
  'discussion.status',
  'panelist.status',
  'transcript.append',
  'insight.upsert',
  'summary.final',
] as const;

export type ConnectionState = 'connecting' | 'open' | 'closed';

export interface StreamState {
  detail: DiscussionDetail | null;
  connection: ConnectionState;
  error: string | null;
  /** 最近一次收到事件的时间，用于界面上的「实时」心跳提示 */
  lastEventAt: number | null;
  /** 本轮连接内新到的发言 id，用于只给新发言播放入场动画 */
  freshEntryIds: string[];
}

const EMPTY: StreamState = {
  detail: null,
  connection: 'connecting',
  error: null,
  lastEventAt: null,
  freshEntryIds: [],
};

function mergeEntry(list: TranscriptEntry[], entry: TranscriptEntry): TranscriptEntry[] {
  if (list.some((item) => item.id === entry.id)) return list;
  return [...list, entry].sort((a, b) => a.seq - b.seq);
}

function mergeInsight(list: Insight[], insight: Insight): Insight[] {
  const index = list.findIndex((item) => item.id === insight.id);
  if (index === -1) {
    return [...list, insight].sort((a, b) => a.round - b.round || a.createdAt - b.createdAt);
  }
  const next = [...list];
  next[index] = insight;
  return next;
}

export function useDiscussionStream(discussionId: string | null): StreamState {
  const [state, setState] = useState<StreamState>(EMPTY);
  const freshBuffer = useRef<string[]>([]);

  useEffect(() => {
    if (!discussionId) {
      setState(EMPTY);
      return;
    }

    let source: EventSource | null = null;
    let disposed = false;

    setState({ ...EMPTY, connection: 'connecting' });
    freshBuffer.current = [];

    const applyEvent = (event: DiscussionEvent): void => {
      setState((prev) => {
        const detail = prev.detail;
        if (!detail) return prev;

        const base = { ...prev, lastEventAt: event.ts || Date.now() };

        switch (event.type) {
          case 'discussion.status': {
            const payload = event.payload as DiscussionStatusPayload;
            return {
              ...base,
              detail: {
                ...detail,
                status: payload.status,
                phase: payload.phase,
                round: payload.round,
                lastSeq: Math.max(detail.lastSeq, event.seq),
              },
            };
          }
          case 'panelist.status': {
            const payload = event.payload as PanelistStatusPayload;
            return {
              ...base,
              detail: {
                ...detail,
                lastSeq: Math.max(detail.lastSeq, event.seq),
                panelists: detail.panelists.map((panelist) =>
                  panelist.id === payload.panelistId
                    ? { ...panelist, status: payload.status, focus: payload.focus }
                    : panelist,
                ),
              },
            };
          }
          case 'transcript.append': {
            const payload = event.payload as TranscriptAppendPayload;
            if (detail.transcript.some((item) => item.id === payload.entry.id)) return base;
            freshBuffer.current = [...freshBuffer.current, payload.entry.id].slice(-4);
            return {
              ...base,
              detail: {
                ...detail,
                transcript: mergeEntry(detail.transcript, payload.entry),
                lastSeq: Math.max(detail.lastSeq, event.seq),
              },
              freshEntryIds: freshBuffer.current,
            };
          }
          case 'insight.upsert': {
            const payload = event.payload as InsightUpsertPayload;
            return {
              ...base,
              detail: {
                ...detail,
                insights: mergeInsight(detail.insights, payload.insight),
                lastSeq: Math.max(detail.lastSeq, event.seq),
              },
            };
          }
          case 'summary.final': {
            const payload = event.payload as SummaryFinalPayload;
            return {
              ...base,
              detail: { ...detail, summary: payload.summary, lastSeq: Math.max(detail.lastSeq, event.seq) },
            };
          }
          default:
            return base;
        }
      });
    };

    const handleMessage = (raw: MessageEvent<string>): void => {
      let event: DiscussionEvent;
      try {
        event = JSON.parse(raw.data) as DiscussionEvent;
      } catch {
        return;
      }
      if (event.type === 'heartbeat') {
        setState((prev) => ({ ...prev, lastEventAt: Date.now() }));
        return;
      }
      applyEvent(event);
    };

    const open = (): void => {
      if (disposed) return;
      source = new EventSource(api.streamUrl(discussionId));

      source.onopen = () => setState((prev) => ({ ...prev, connection: 'open', error: null }));

      // snapshot 是唯一「整体替换」的事件
      source.addEventListener('snapshot', (raw) => {
        let event: DiscussionEvent<DiscussionDetail>;
        try {
          event = JSON.parse((raw as MessageEvent<string>).data) as DiscussionEvent<DiscussionDetail>;
        } catch {
          return;
        }
        freshBuffer.current = [];
        setState((prev) => ({
          ...prev,
          detail: event.payload,
          connection: 'open',
          error: null,
          lastEventAt: Date.now(),
          freshEntryIds: [],
        }));
      });

      for (const type of EVENT_TYPES) {
        if (type === 'snapshot') continue;
        source.addEventListener(type, handleMessage as EventListener);
      }

      // 注意：浏览器把「连接层错误」和「服务端下发的 event: error」都派发到 error 上，
      // 用 data 是否为空区分二者。
      source.addEventListener('error', (raw) => {
        const data = (raw as MessageEvent<string>).data;
        if (typeof data === 'string' && data !== '') {
          try {
            const event = JSON.parse(data) as DiscussionEvent<{ message?: string }>;
            setState((prev) => ({ ...prev, error: event.payload?.message ?? '讨论引擎出现异常' }));
            return;
          } catch {
            /* 落到下面按连接错误处理 */
          }
        }
        // EventSource 会自行重连，这里只反映当前连接状态
        setState((prev) => ({ ...prev, connection: prev.detail ? 'closed' : 'connecting' }));
      });
    };

    open();

    return () => {
      disposed = true;
      source?.close();
    };
  }, [discussionId]);

  return state;
}
