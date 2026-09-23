import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api/client';
import { InsightBoard } from '../components/InsightBoard';
import { RosterPanel } from '../components/RosterPanel';
import { SummaryCard } from '../components/SummaryCard';
import { TranscriptFeed } from '../components/TranscriptFeed';
import { navigate } from '../hooks/useHashRoute';
import { useDiscussionStream } from '../hooks/useDiscussionStream';
import { phaseLabel, statusLabel, statusTone } from '../lib/format';

interface Props {
  discussionId: string;
}

type Tab = 'roster' | 'stage' | 'board';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'roster', label: '嘉宾席' },
  { key: 'stage', label: '现场' },
  { key: 'board', label: '共识与分歧' },
];

/**
 * 演播厅。
 *
 * 三栏结构固定为「人 / 现场 / 结论」：嘉宾席（状态小窗）、Transcript、共识与分歧板。
 * 整页不滚动 —— 三个区域各自滚动，超宽屏三栏并列、常规桌面收成两栏、
 * 窄屏退化为单栏 + 标签切换，但每个区域的滚动边界始终是它自己的容器。
 */
export function StudioPage({ discussionId }: Props) {
  const { detail, connection, error, freshEntryIds } = useDiscussionStream(discussionId);
  const [tab, setTab] = useState<Tab>('stage');
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setTab('stage');
    setActionError(null);
  }, [discussionId]);

  const run = useCallback(
    async (label: string, action: () => Promise<unknown>): Promise<void> => {
      setPending(label);
      setActionError(null);
      try {
        await action();
      } catch (cause) {
        setActionError(cause instanceof ApiError ? cause.message : '操作失败，请重试');
      } finally {
        setPending(null);
      }
    },
    [],
  );

  if (!detail) {
    return (
      <div className="page studio studio--loading">
        <div className="empty">
          <p className="empty__title serif">正在接入演播厅…</p>
          <p className="empty__hint faint">
            {error ?? '正在建立实时连接并同步当前讨论状态。'}
          </p>
          <button type="button" className="btn btn--sm" onClick={() => navigate('/')}>
            返回首页
          </button>
        </div>
      </div>
    );
  }

  const isLive = detail.status === 'live';
  const isPaused = detail.status === 'paused';
  const isReady = detail.status === 'ready' || detail.status === 'draft';
  const isEnded = detail.status === 'ended';
  const busy = pending !== null;

  return (
    <div className="page studio">
      <header className="studio__head">
        <div className="studio__head-main">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigate('/')}>
            ←
          </button>
          <div className="studio__head-text">
            <div className="studio__head-top">
              {isLive && (
                <span className="on-air">
                  <span className="on-air__lamp" />
                  ON AIR
                </span>
              )}
              <span className={`badge ${statusTone(detail.status)}`}>{statusLabel(detail.status)}</span>
              {!isEnded && !isReady && (
                <span className="mono faint studio__round">
                  第 {Math.max(detail.round, 1)} 轮 · {phaseLabel(detail.phase)}
                </span>
              )}
              <span className="conn" data-state={connection === 'open' ? 'open' : 'closed'}>
                <span className="dot" />
                {connection === 'open' ? '实时推送中' : '连接中断，正在重连'}
              </span>
            </div>
            <h1 className="studio__topic serif">{detail.topic}</h1>
          </div>
        </div>

        <div className="studio__controls">
          {isReady && (
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() => void run('start', () => api.start(detail.id))}
            >
              {pending === 'start' ? '正在启动…' : '开始讨论'}
            </button>
          )}

          {isLive && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void run('pause', () => api.pause(detail.id))}
            >
              暂停
            </button>
          )}

          {isPaused && (
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() => void run('resume', () => api.resume(detail.id))}
            >
              继续
            </button>
          )}

          {(isLive || isPaused) && (
            <button
              type="button"
              className="btn btn--danger"
              disabled={busy}
              onClick={() => void run('stop', () => api.stop(detail.id))}
            >
              {pending === 'stop' ? '正在收尾…' : '结束讨论'}
            </button>
          )}

          {isEnded && (
            <button type="button" className="btn" onClick={() => navigate('/')}>
              返回首页
            </button>
          )}
        </div>
      </header>

      {(actionError || error) && (
        <div className="alert alert--inline">
          <span>{actionError ?? error}</span>
        </div>
      )}

      <nav className="studio__tabs" role="tablist" aria-label="演播厅区域">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            className="tabs__item"
            data-active={tab === item.key}
            aria-selected={tab === item.key}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="studio__body" data-tab={tab}>
        <aside className="studio__region panel studio__region--roster">
          <header className="section-head">
            <span className="section-head__title">嘉宾席</span>
            <span className="mono faint">{detail.panelists.length} 人</span>
          </header>
          <RosterPanel panelists={detail.panelists} />
        </aside>

        <section className="studio__region panel studio__region--stage">
          <header className="section-head">
            <span className="section-head__title">现场 Transcript</span>
            <span className="mono faint">{detail.transcript.length} 条发言</span>
          </header>
          <TranscriptFeed
            entries={detail.transcript}
            panelists={detail.panelists}
            freshIds={freshEntryIds}
            live={!isEnded && !isReady}
          />
        </section>

        <aside className="studio__region panel studio__region--board">
          <header className="section-head">
            <span className="section-head__title">实时共识与分歧</span>
            <span className="mono faint">
              {detail.insights.filter((item) => item.kind === 'consensus').length} 共识 ·{' '}
              {detail.insights.filter((item) => item.kind === 'divergence').length} 分歧
            </span>
          </header>

          {detail.summary && (
            <div className="studio__summary">
              <SummaryCard summary={detail.summary} ended={isEnded} />
            </div>
          )}

          <InsightBoard insights={detail.insights} panelists={detail.panelists} />
        </aside>
      </div>
    </div>
  );
}
