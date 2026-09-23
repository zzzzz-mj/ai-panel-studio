import { describe, expect, it } from 'vitest';
import { asEnum, asNumber, clampSentences, cleanUtterance, extractJson } from '../../src/llm/json';

describe('模型输出容错解析', () => {
  it('解析纯 JSON', () => {
    expect(extractJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it('剥掉 Markdown 代码块围栏', () => {
    const raw = '```json\n{"host":{"name":"甲"},"experts":[]}\n```';
    expect(extractJson<{ host: { name: string } }>(raw)?.host.name).toBe('甲');
  });

  it('容忍模型在 JSON 前后加的解释性文字', () => {
    const raw = '好的，以下是阵容：\n{"experts":[{"name":"乙"}]}\n希望对你有帮助。';
    expect(extractJson<{ experts: Array<{ name: string }> }>(raw)?.experts[0]?.name).toBe('乙');
  });

  it('无法解析时返回 null，而不是抛错', () => {
    expect(extractJson('这不是 JSON')).toBeNull();
    expect(extractJson('')).toBeNull();
  });

  it('枚举越界时回退到兜底值', () => {
    expect(asEnum('rebuttal', ['claim', 'rebuttal'] as const, 'claim')).toBe('rebuttal');
    expect(asEnum('乱写的', ['claim', 'rebuttal'] as const, 'claim')).toBe('claim');
  });

  it('数值被夹在合法区间内', () => {
    expect(asNumber(999, 0, 0, 100)).toBe(100);
    expect(asNumber(-5, 0, 0, 100)).toBe(0);
    expect(asNumber('abc', 42, 0, 100)).toBe(42);
  });
});

describe('发言正文清洗（1-2 句的硬约束）', () => {
  it('去掉姓名前缀与包裹引号', () => {
    expect(cleanUtterance('张三：我认为成本被低估了。')).toBe('我认为成本被低估了。');
    expect(cleanUtterance('「这只是一个测试。」')).toBe('这只是一个测试。');
    expect(cleanUtterance('李四（经济学教授）：口径不同结论就不同。')).toBe('口径不同结论就不同。');
  });

  it('最多保留两句', () => {
    const result = cleanUtterance('第一句。第二句。第三句。第四句。');
    expect(result).toBe('第一句。第二句。');
  });

  it('超长句被截断并加省略号', () => {
    const long = `${'很长的内容'.repeat(40)}。`;
    const result = clampSentences(long, 2, 30);
    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(31);
  });

  it('没有句末标点时，短文本原样返回', () => {
    expect(cleanUtterance('没有标点的一句短发言')).toBe('没有标点的一句短发言');
  });

  it('没有句末标点的超长文本被截断', () => {
    const result = cleanUtterance('很长的一段没有标点的发言内容'.repeat(20));
    expect(result).toHaveLength(90);
  });
});
