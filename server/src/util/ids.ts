import { randomBytes } from 'node:crypto';

/** 短 ID：可读、可排序前缀、便于日志排查。 */
function shortId(prefix: string, bytes = 3): string {
  return `${prefix}-${randomBytes(bytes).toString('hex')}`;
}

export const newDiscussionId = (): string => shortId('d');
export const newPanelistId = (): string => shortId('p');
export const newTranscriptId = (): string => shortId('t', 4);
export const newInsightId = (): string => shortId('i', 4);
