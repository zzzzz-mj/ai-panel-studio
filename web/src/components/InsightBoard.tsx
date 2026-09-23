import type { Insight, Panelist } from '../api/types';
import { insightStatusLabel, withAlpha } from '../lib/format';

interface Props {
  insights: Insight[];
  panelists: Panelist[];
}

/**
 * 实时共识与分歧板。
 *
 * 这个区域不是「讨论结束后生成报告」，而是随轮次持续 upsert：
 * 一条 insight 会从「仍在形成」变成「已稳定」，支持者也会随发言增加，
 * 因此这里只按 round / 时间排序渲染，不做任何缓存或延迟。
 */
export function InsightBoard({ insights, panelists }: Props) {
  const byId = new Map(panelists.map((panelist) => [panelist.id, panelist]));
  const consensus = insights.filter((item) => item.kind === 'consensus');
  const divergence = insights.filter((item) => item.kind === 'divergence');

  if (insights.length === 0) {
    return (
      <div className="board scroll-y">
        <div className="empty empty--compact">
          <p className="empty__title serif">尚未形成共识或分歧</p>
          <p className="empty__hint faint">引擎会在每轮发言后重新提炼，这里会自动出现第一批条目。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="board scroll-y">
      <Group
        title="正在形成的共识"
        tone="consensus"
        items={consensus}
        byId={byId}
        emptyHint="还没有出现被多位嘉宾共同认可的判断。"
      />
      <Group
        title="尚未解决的分歧"
        tone="divergence"
        items={divergence}
        byId={byId}
        emptyHint="目前嘉宾之间还没有出现正面冲突的立场。"
      />
    </div>
  );
}

interface GroupProps {
  title: string;
  tone: 'consensus' | 'divergence';
  items: Insight[];
  byId: Map<string, Panelist>;
  emptyHint: string;
}

function Group({ title, tone, items, byId, emptyHint }: GroupProps) {
  return (
    <section className={`board__group board__group--${tone}`}>
      <header className="board__group-head">
        <span className="board__group-title">{title}</span>
        <span className="mono faint">{items.length}</span>
      </header>

      {items.length === 0 ? (
        <p className="board__empty faint">{emptyHint}</p>
      ) : (
        <ul className="board__list">
          {items.map((item) => (
            <li key={item.id} className="insight on-enter" data-tone={tone}>
              <p className="insight__statement">{item.statement}</p>

              {item.tension && <p className="insight__tension faint">张力：{item.tension}</p>}

              <div className="insight__foot">
                <div className="insight__supporters">
                  {item.supporterIds.map((id) => {
                    const panelist = byId.get(id);
                    if (!panelist) return null;
                    return (
                      <span
                        key={id}
                        className="supporter"
                        style={{
                          color: panelist.color,
                          background: withAlpha(panelist.color, 0.14),
                          borderColor: withAlpha(panelist.color, 0.4),
                        }}
                      >
                        {panelist.name}
                      </span>
                    );
                  })}
                </div>
                <span className={`badge badge--${tone}`}>{insightStatusLabel(item.status)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
