import type { PresetTopic } from '../api/types';

interface Props {
  presets: PresetTopic[];
  onPick: (preset: PresetTopic) => void;
}

/**
 * 预置议题库（样例数据入口）。
 *
 * 这里刻意不做成卡片网格：议题是「可扫读的列表」，靠标签与人数做区分，
 * 让「发起新讨论」这个主操作保持唯一的视觉重量。
 */
export function PresetRail({ presets, onPick }: Props) {
  if (presets.length === 0) {
    return <p className="faint preset-rail__empty">预置议题库为空，可执行 npm run db:seed 重新灌入样例数据。</p>;
  }

  return (
    <ul className="preset-rail">
      {presets.map((preset, index) => (
        <li key={preset.id} className="preset-rail__item on-enter" style={{ ['--i' as string]: index }}>
          <button type="button" className="preset-rail__button" onClick={() => onPick(preset)}>
            <span className="preset-rail__topic serif">{preset.topic}</span>
            <span className="preset-rail__meta mono">
              {preset.expertCount} 位专家
              {preset.tags.length > 0 && <span className="faint"> · {preset.tags.join(' / ')}</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
