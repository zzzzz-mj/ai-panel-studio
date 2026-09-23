import type { Panelist } from '../api/types';
import { initialOf, panelistStatusLabel, withAlpha } from '../lib/format';

interface Props {
  panelists: Panelist[];
}

/**
 * 专家状态小窗。
 *
 * 展示的是「运行状态 + 公开关注点」，而不是模型的隐藏推理链：
 * 后端下发的 focus 字段本身就是一句对外可见的摘要，这里只负责呈现。
 */
export function RosterPanel({ panelists }: Props) {
  return (
    <div className="roster scroll-y">
      <ul className="roster__list">
        {panelists.map((panelist) => (
          <li
            key={panelist.id}
            className="roster__item"
            data-status={panelist.status}
            style={{ ['--accent' as string]: panelist.color }}
          >
            <span className="roster__lamp" aria-hidden="true" />

            <div className="roster__head">
              <span
                className="roster__avatar"
                style={{ background: withAlpha(panelist.color, 0.16), color: panelist.color }}
              >
                {initialOf(panelist.name)}
              </span>
              <div className="roster__ident">
                <span className="roster__name">
                  {panelist.name}
                  {panelist.role === 'host' && <span className="roster__host-tag">主持</span>}
                </span>
                <span className="roster__title faint">{panelist.title}</span>
              </div>
            </div>

            <div className="roster__status">
              <span className="roster__status-text">{panelistStatusLabel(panelist.status)}</span>
            </div>

            {panelist.focus && <p className="roster__focus">{panelist.focus}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
