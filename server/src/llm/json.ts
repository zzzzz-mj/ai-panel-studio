/**
 * 模型输出的容错解析。
 *
 * 即使 prompt 明确要求「只输出 JSON」，真实模型仍可能包上 ```json 代码块、
 * 前置一句"好的，以下是……"。这一层负责把这些噪声剥掉，并把字段强转成
 * 引擎能安全消费的形状 —— 解析失败时返回兜底值而不是让整场讨论崩掉。
 */

/** 从任意文本中抠出第一个完整的 JSON 对象或数组。 */
export function extractJson<T>(raw: string): T | null {
  if (!raw) return null;
  let text = raw.trim();

  // 剥掉 Markdown 代码块围栏
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) text = fence[1].trim();

  const direct = tryParse<T>(text);
  if (direct !== null) return direct;

  // 退一步：截取第一个 { 到最后一个 }（或 [ ... ]）
  for (const [open, close] of [
    ['{', '}'],
    ['[', ']'],
  ] as const) {
    const start = text.indexOf(open);
    const end = text.lastIndexOf(close);
    if (start !== -1 && end > start) {
      const sliced = tryParse<T>(text.slice(start, end + 1));
      if (sliced !== null) return sliced;
    }
  }
  return null;
}

function tryParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** 安全取字符串字段。 */
export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

/** 安全取字符串数组。 */
export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((s) => s.trim());
}

/** 安全取布尔。 */
export function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** 安全取数字并夹在区间内。 */
export function asNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** 安全取对象数组。 */
export function asObjectArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
}

/** 从对象里挑一个枚举值，不在白名单内则用兜底值。 */
export function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const s = typeof value === 'string' ? value.trim() : '';
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

/**
 * 发言正文清洗：去掉模型爱加的前缀与引号，并强制 1-2 句。
 * 这是「每次发言控制在 1-2 句」这条产品要求在服务端的最后一道保险。
 */
export function cleanUtterance(raw: string): string {
  let text = raw.trim();
  text = text.replace(/^```[\s\S]*?```$/g, (m) => m.replace(/```(?:json)?/gi, '').trim());
  text = text.replace(/^["'“”「『]+|["'“”」』]+$/g, '');
  // 去掉「张三：」「张三（教授）：」这类姓名前缀
  text = text.replace(/^[\u4e00-\u9fa5A-Za-z·]{2,6}\s*[（(][^）)]{0,20}[）)]\s*[:：]\s*/, '');
  text = text.replace(/^[\u4e00-\u9fa5A-Za-z·]{2,4}\s*[:：]\s*/, '');
  text = text.replace(/\s+/g, ' ').trim();
  return clampSentences(text, 2, 90);
}

/** 按中英文句末标点切句，保留前 maxSentences 句；超长句直接截断。 */
export function clampSentences(text: string, maxSentences: number, maxCharsPerSentence: number): string {
  const parts = text
    .split(/(?<=[。！？!?；;])/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return text.slice(0, maxCharsPerSentence);
  return parts
    .slice(0, maxSentences)
    .map((s) => (s.length > maxCharsPerSentence ? `${s.slice(0, maxCharsPerSentence - 1)}…` : s))
    .join('');
}
