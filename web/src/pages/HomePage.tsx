import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '../api/client';
import type { DiscussionSummary, PresetTopic } from '../api/types';
import { DiscussionCard } from '../components/DiscussionCard';
import { PresetRail } from '../components/PresetRail';
import { navigate } from '../hooks/useHashRoute';

type Filter = 'all' | 'live' | 'ready' | 'ended';

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'live', label: '进行中' },
  { key: 'ready', label: '待开始' },
  { key: 'ended', label: '已结束' },
];

/** 首页：进行中的讨论列表 + 发起新讨论 + 预置议题库。 */
export function HomePage() {
  const [items, setItems] = useState<DiscussionSummary[]>([]);
  const [presets, setPresets] = useState<PresetTopic[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [discussions, presetList] = await Promise.all([api.listDiscussions('all'), api.listPresets()]);
      setItems(discussions);
      setPresets(presetList);
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // 列表页不需要 SSE：低频轮询足以反映其它讨论的推进
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  const counts = useMemo(() => {
    const live = items.filter((item) => item.status === 'live' || item.status === 'paused').length;
    const ready = items.filter((item) => item.status === 'ready' || item.status === 'draft').length;
    const ended = items.filter((item) => item.status === 'ended').length;
    return { all: items.length, live, ready, ended };
  }, [items]);

  const visible = useMemo(() => {
    if (filter === 'all') return items;
    if (filter === 'live') return items.filter((item) => item.status === 'live' || item.status === 'paused');
    if (filter === 'ready') return items.filter((item) => item.status === 'ready' || item.status === 'draft');
    return items.filter((item) => item.status === 'ended');
  }, [items, filter]);

  return (
    <div className="page home">
      <div className="home__grid">
        <section className="home__main">
          <header className="home__head">
            <div>
              <p className="eyebrow">讨论列表</p>
              <h1 className="home__title serif">进行中的圆桌</h1>
            </div>
            <div className="tabs" role="tablist" aria-label="按状态筛选">
              {FILTERS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  className="tabs__item"
                  data-active={filter === tab.key}
                  aria-selected={filter === tab.key}
                  onClick={() => setFilter(tab.key)}
                >
                  {tab.label}
                  <span className="mono tabs__count">{counts[tab.key]}</span>
                </button>
              ))}
            </div>
          </header>

          <div className="home__list scroll-y">
            {error && (
              <div className="alert">
                <span>{error}</span>
                <button type="button" className="btn btn--sm" onClick={() => void load()}>
                  重试
                </button>
              </div>
            )}

            {loading && items.length === 0 && <p className="faint home__loading">正在载入讨论…</p>}

            {!loading && visible.length === 0 && !error && (
              <div className="empty">
                <p className="empty__title serif">这里还没有讨论</p>
                <p className="empty__hint faint">从右侧挑一个预置议题，或直接发起一场属于你的圆桌。</p>
              </div>
            )}

            <div className="home__cards">
              {visible.map((item, index) => (
                <DiscussionCard
                  key={item.id}
                  item={item}
                  index={index}
                  onOpen={(id) => navigate(`/d/${id}`)}
                />
              ))}
            </div>
          </div>
        </section>

        <aside className="home__side scroll-y">
          <div className="cta">
            <p className="eyebrow">发起新讨论</p>
            <h2 className="cta__title serif">召集一场圆桌</h2>
            <p className="cta__text">
              输入一个待讨论的议题与参会专家人数，系统会动态生成主持人与专家阵容。确认之后，讨论由 AI 驱动实时推进。
            </p>
            <button type="button" className="btn btn--primary cta__button" onClick={() => navigate('/new')}>
              发起新讨论
            </button>
          </div>

          <section className="presets">
            <header className="section-head">
              <span className="section-head__title">预置议题库</span>
              <span className="mono faint">{presets.length} 条样例</span>
            </header>
            <PresetRail presets={presets} onPick={(preset) => navigate(`/new?preset=${preset.id}`)} />
          </section>
        </aside>
      </div>
    </div>
  );
}
