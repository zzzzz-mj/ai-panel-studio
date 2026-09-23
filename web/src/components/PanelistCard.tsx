import { useEffect, useState } from 'react';
import type { Panelist, PanelistPatch } from '../api/types';
import { initialOf, withAlpha } from '../lib/format';

interface Props {
  panelist: Panelist;
  palette: readonly string[];
  onPatch: (panelistId: string, patch: PanelistPatch) => Promise<void>;
  saving: boolean;
}

/**
 * 嘉宾卡片（确认前可微调）。
 *
 * 用户在这里改的是「人设」而不是「内容」：姓名 / Title / 立场 / 身份色。
 * 身份色一旦确定，就会贯穿演播厅的状态灯、发言色块与共识标签。
 */
export function PanelistCard({ panelist, palette, onPatch, saving }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PanelistPatch>({});

  // 重新生成阵容后，卡片需要跟着最新的服务端数据走
  useEffect(() => {
    setDraft({});
    setEditing(false);
  }, [panelist.id, panelist.name, panelist.title, panelist.stance, panelist.color]);

  const isHost = panelist.role === 'host';
  const value = (key: keyof PanelistPatch, fallback: string): string => {
    const current = draft[key];
    return typeof current === 'string' ? current : fallback;
  };

  const dirty = Object.keys(draft).length > 0;

  const commit = async (): Promise<void> => {
    if (!dirty) {
      setEditing(false);
      return;
    }
    await onPatch(panelist.id, draft);
    setDraft({});
    setEditing(false);
  };

  const update = (key: keyof PanelistPatch, next: string): void => {
    setDraft((prev) => ({ ...prev, [key]: next }));
  };

  return (
    <article className="pcard on-enter" style={{ ['--accent' as string]: panelist.color }}>
      <span className="pcard__accent" aria-hidden="true" />

      <header className="pcard__head">
        <span className="pcard__avatar" style={{ background: withAlpha(panelist.color, 0.16), color: panelist.color }}>
          {initialOf(panelist.name)}
        </span>
        <div className="pcard__ident">
          {editing ? (
            <input
              className="input input--inline"
              value={value('name', panelist.name)}
              maxLength={20}
              aria-label="姓名"
              onChange={(event) => update('name', event.target.value)}
            />
          ) : (
            <h3 className="pcard__name serif">{panelist.name}</h3>
          )}

          {editing ? (
            <input
              className="input input--inline"
              value={value('title', panelist.title)}
              maxLength={40}
              aria-label="职业 / Title"
              onChange={(event) => update('title', event.target.value)}
            />
          ) : (
            <p className="pcard__title">
              {panelist.title}
              {panelist.org && <span className="faint"> · {panelist.org}</span>}
            </p>
          )}
        </div>
        {isHost && <span className="badge badge--ready">主持</span>}
      </header>

      <div className="pcard__stance">
        <span className="eyebrow">立场</span>
        {editing ? (
          <textarea
            className="textarea"
            rows={3}
            maxLength={200}
            value={value('stance', panelist.stance)}
            aria-label="立场"
            onChange={(event) => update('stance', event.target.value)}
          />
        ) : (
          <p className="pcard__stance-text">{panelist.stance}</p>
        )}
      </div>

      {editing && !isHost && (
        <div className="pcard__colors">
          <span className="eyebrow">身份色</span>
          <div className="swatches">
            {palette.map((color) => {
              const active = (draft.color ?? panelist.color) === color;
              return (
                <button
                  key={color}
                  type="button"
                  className="swatch"
                  data-active={active}
                  style={{ background: color }}
                  aria-label={`选择颜色 ${color}`}
                  aria-pressed={active}
                  onClick={() => update('color', color)}
                />
              );
            })}
          </div>
        </div>
      )}

      <footer className="pcard__foot">
        <p className="pcard__bio faint">{panelist.bio}</p>
        <div className="pcard__actions">
          {editing ? (
            <>
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={() => {
                  setDraft({});
                  setEditing(false);
                }}
              >
                取消
              </button>
              <button type="button" className="btn btn--sm btn--primary" disabled={saving} onClick={commit}>
                {saving ? '保存中…' : '保存'}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => setEditing(true)}>
              微调
            </button>
          )}
        </div>
      </footer>
    </article>
  );
}
