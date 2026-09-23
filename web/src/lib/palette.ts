/**
 * 嘉宾身份色板（与 server/src/util/palette.ts 保持一致的只读副本）。
 *
 * 服务端在生成阵容时分配颜色，前端只在「确认前微调身份色」这一个场景下
 * 需要展示可选集合，因此这里不做任何分配逻辑，只提供候选色。
 */
export const PANELIST_PALETTE: readonly string[] = [
  '#5FB3C9',
  '#C97BB0',
  '#8FBF6A',
  '#D9885F',
  '#9B8CE0',
  '#E0C25F',
  '#62C2A0',
  '#D9737A',
];

export const HOST_COLOR = '#E7B24A';
