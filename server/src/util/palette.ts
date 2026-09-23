/**
 * 嘉宾配色。
 *
 * 选取标准：在近黑底色上保持 ≥4.5:1 的正文对比度、彼此色相间隔足够大，
 * 且避免与品牌主色（舞台琥珀金 #E7B24A）混淆 —— 颜色是嘉宾的身份标识，
 * 必须在状态灯、发言色块、共识分歧标签三处都能一眼区分。
 */
export const PANELIST_PALETTE: readonly string[] = [
  '#5FB3C9', // 湖蓝
  '#C97BB0', // 品红
  '#8FBF6A', // 苔绿
  '#D9885F', // 陶橙
  '#9B8CE0', // 紫罗兰
  '#E0C25F', // 麦黄
  '#62C2A0', // 青碧
  '#D9737A', // 玫瑰
];

export function pickColor(index: number): string {
  const color = PANELIST_PALETTE[index % PANELIST_PALETTE.length];
  return color ?? PANELIST_PALETTE[0]!;
}
