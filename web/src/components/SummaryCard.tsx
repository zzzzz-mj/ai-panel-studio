interface Props {
  summary: string | null;
  ended: boolean;
}

/**
 * 主持人总结。
 *
 * 后端产出的是一段自然语言，这里直接按段落渲染 ——
 * 不做 JSON 美化、不做字段展开，页面上不会出现任何结构原文。
 */
export function SummaryCard({ summary, ended }: Props) {
  if (!summary) {
    return (
      <section className="summary summary--pending">
        <header className="summary__head">
          <span className="eyebrow">主持人总结</span>
        </header>
        <p className="faint summary__pending-text">
          {ended ? '本场没有生成总结。' : '讨论结束后，主持人会在这里给出一段自然语言的收束。'}
        </p>
      </section>
    );
  }

  return (
    <section className="summary on-enter">
      <header className="summary__head">
        <span className="eyebrow">主持人总结</span>
        <span className="mono faint">自然语言 · 非结构化输出</span>
      </header>
      <p className="summary__text serif">{summary}</p>
    </section>
  );
}
