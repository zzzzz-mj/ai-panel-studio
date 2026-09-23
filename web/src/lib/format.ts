import type { DiscussionStatus, InsightStatus, Intent, PanelistStatus, Phase } from '../api/types';

/** 展示层文案映射：领域枚举 → 中文界面文案。 */

const STATUS_LABEL: Record<DiscussionStatus, string> = {
  draft: '待生成阵容',
  ready: '待开始',
  live: '进行中',
  paused: '已暂停',
  ended: '已结束',
};

const PHASE_LABEL: Record<Phase, string> = {
  opening: '开场',
  exploration: '立场陈述',
  conflict: '观点交锋',
  convergence: '收敛',
  closing: '收尾',
  done: '已结束',
};

const PANELIST_STATUS_LABEL: Record<PanelistStatus, string> = {
  idle: '待机',
  ready: '准备发言',
  speaking: '发言中',
  thinking: '整理思路',
};

const INTENT_LABEL: Record<Intent, string> = {
  open: '开场',
  question: '追问',
  bridge: '串联',
  claim: '立论',
  rebuttal: '反驳',
  supplement: '补充',
  agree: '呼应',
  summary: '总结',
};

const INSIGHT_STATUS_LABEL: Record<InsightStatus, string> = {
  emerging: '仍在形成',
  stable: '已稳定',
};

export const statusLabel = (status: DiscussionStatus): string => STATUS_LABEL[status] ?? status;
export const phaseLabel = (phase: Phase): string => PHASE_LABEL[phase] ?? phase;
export const panelistStatusLabel = (status: PanelistStatus): string => PANELIST_STATUS_LABEL[status] ?? status;
export const intentLabel = (intent: Intent): string => INTENT_LABEL[intent] ?? intent;
export const insightStatusLabel = (status: InsightStatus): string => INSIGHT_STATUS_LABEL[status] ?? status;

/** 状态徽标的修饰类，用于统一「进行中=朱红 / 待开始=琥珀 / 已结束=灰」的语义。 */
export function statusTone(status: DiscussionStatus): string {
  if (status === 'live') return 'badge--live';
  if (status === 'ready') return 'badge--ready';
  if (status === 'paused') return 'badge--paused';
  return 'badge--ended';
}

/** 等宽时间戳：HH:MM:SS。 */
export function formatClock(ts: number | null | undefined): string {
  if (!ts) return '--:--:--';
  const date = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 相对时间：刚刚 / N 分钟前 / MM-DD HH:MM。 */
export function formatRelative(ts: number | null | undefined): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 45_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} 小时前`;
  const date = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 讨论时长：mm:ss。 */
export function formatDuration(from: number | null, to: number | null): string {
  if (!from) return '—';
  const end = to ?? Date.now();
  const seconds = Math.max(0, Math.round((end - from) / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
}

/** 取姓名首字作为头像字形（中文取 1 字，英文取首字母）。 */
export function initialOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '·';
  return /[\u4e00-\u9fa5]/.test(trimmed[0]!) ? trimmed[0]! : trimmed[0]!.toUpperCase();
}

/** 把 hex 颜色转成带透明度的 rgba，用于色块底纹。 */
export function withAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return `rgba(231, 178, 74, ${alpha})`;
  const value = Number.parseInt(match[1]!, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
