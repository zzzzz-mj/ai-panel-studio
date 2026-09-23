import type { DiscussionSummary } from '../api/types';
import { formatRelative, statusLabel, statusTone } from '../lib/format';

interface Props {
  item: DiscussionSummary;
  index: number;
  onOpen: (id: string) => void;
}

/**
 * 首页的讨论卡片。
 *
 * 配色条（palette）是这张卡片的识别锚点：用户在首页就能记住一场讨论的
 * 颜色组合，进入演播厅后靠同一组颜色继续追踪发言人。
 */
export function DiscussionCard({ item, index, onOpen }: Props) {
  const counts = [
    { label: '发言', value: item.entryCount },
    { label: '共识', value: item.consensusCount },
    { label: '分歧', value: item.divergenceCount },
  ];

  return (
    <article className="disc-card on-enter" style={{ ['--i' as string]: index }}>
      <div className="disc-card__palette" aria-hidden="true">
        {item.palette.map((color, i) => (
          <span key={`${color}-${i}`} className="disc-card__swatch" style={{ background: color }} />
        ))}
      </div>

      <div className="disc-card__body">
        <div className="disc-card__top">
          <span className={`badge ${statusTone(item.status)}`}>
            {item.status === 'live' && <span className="dot" />}
            {statusLabel(item.status)}
          </span>
          <span className="mono faint disc-card__time">{formatRelative(item.startedAt ?? item.createdAt)}</span>
        </div>

        <h3 className="disc-card__topic serif">{item.topic}</h3>

        {item.preview ? (
          <p className="disc-card__preview">{item.preview}</p>
        ) : (
          <p className="disc-card__preview faint">阵容已就绪，等待你确认后开始。</p>
        )}

        <div className="disc-card__foot">
          <div className="disc-card__counts">
            <span className="mono faint">{item.panelistCount} 位嘉宾</span>
            {counts.map((c) => (
              <span key={c.label} className="mono faint">
                {c.label} {c.value}
              </span>
            ))}
          </div>
          <button type="button" className="btn btn--sm" onClick={() => onOpen(item.id)}>
            {item.status === 'ended' ? '回放' : item.status === 'ready' ? '进入准备' : '加入'}
          </button>
        </div>
      </div>
    </article>
  );
}
