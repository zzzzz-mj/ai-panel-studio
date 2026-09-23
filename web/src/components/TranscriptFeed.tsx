import { useCallback, useEffect, useRef, useState } from 'react';
import type { Panelist, TranscriptEntry } from '../api/types';
import { formatClock, intentLabel, withAlpha } from '../lib/format';

interface Props {
  entries: TranscriptEntry[];
  panelists: Panelist[];
  /** 本轮连接内新到的发言，仅这些条目播放入场动画 */
  freshIds: string[];
  live: boolean;
}

/**
 * 现场 Transcript。
 *
 * 只渲染「谁说了什么」：姓名 + 职业/Title + 与嘉宾一致的色块。
 * 「举手 / 抢答 / 轮到我」这类内部调度事件根本不会进入这条数据流 ——
 * 服务端在落库前就把它们过滤掉了，前端也就无从显示。
 */
export function TranscriptFeed({ entries, panelists, freshIds, live }: Props) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [pinned, setPinned] = useState(true);

  const byId = new Map(panelists.map((panelist) => [panelist.id, panelist]));

  const onScroll = useCallback(() => {
    const node = viewportRef.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    setPinned(distance < 72);
  }, []);

  // 只要用户还贴在底部，新发言就自动跟随；用户向上翻阅时不打扰他
  useEffect(() => {
    if (!pinned) return;
    const node = viewportRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [entries.length, pinned]);

  const jumpToLatest = (): void => {
    const node = viewportRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
    setPinned(true);
  };

  if (entries.length === 0) {
    return (
      <div className="transcript">
        <div className="empty">
          <p className="empty__title serif">{live ? '主持人即将开场' : '这场讨论还没有开始'}</p>
          <p className="empty__hint faint">
            {live ? '引擎正在生成本场议题的开场白与嘉宾首轮立场。' : '确认阵容后点击「开始讨论」，发言会实时出现在这里。'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="transcript">
      <div className="transcript__viewport scroll-y" ref={viewportRef} onScroll={onScroll}>
        <ol className="transcript__list">
          {entries.map((entry) => {
            const speaker = byId.get(entry.panelistId);
            const color = speaker?.color ?? '#8A93A3';
            const isFresh = freshIds.includes(entry.id);

            return (
              <li
                key={entry.id}
                className={`utterance${isFresh ? ' utterance--fresh' : ''}`}
                style={{ ['--accent' as string]: color, background: withAlpha(color, 0.05) }}
              >
                <span className="utterance__rail" aria-hidden="true" />

                <div className="utterance__body">
                  <div className="utterance__head">
                    <span className="utterance__name" style={{ color }}>
                      {speaker?.name ?? '嘉宾'}
                    </span>
                    <span className="utterance__title faint">{speaker?.title ?? ''}</span>
                    <span className="utterance__intent mono">{intentLabel(entry.intent)}</span>
                    <span className="utterance__time mono faint">{formatClock(entry.createdAt)}</span>
                  </div>
                  <p className="utterance__content">{entry.content}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {!pinned && (
        <button type="button" className="transcript__jump on-fade" onClick={jumpToLatest}>
          回到最新发言
        </button>
      )}
    </div>
  );
}
