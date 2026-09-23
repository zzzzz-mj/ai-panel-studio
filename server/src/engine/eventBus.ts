import type { DiscussionEvent } from '../domain/types';

/**
 * 进程内事件总线，按 discussionId 分区。
 *
 * 这是「多讨论并行且状态互相隔离」的关键：订阅者只收到自己那场讨论的事件，
 * 一个讨论的引擎异常不会影响另一个讨论的 SSE 连接。
 */

type Listener = (event: DiscussionEvent) => void;

class EventBus {
  private readonly listeners = new Map<string, Set<Listener>>();

  subscribe(discussionId: string, listener: Listener): () => void {
    let bucket = this.listeners.get(discussionId);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(discussionId, bucket);
    }
    bucket.add(listener);

    return () => {
      const current = this.listeners.get(discussionId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(discussionId);
    };
  }

  publish(event: DiscussionEvent): void {
    const bucket = this.listeners.get(event.discussionId);
    if (!bucket) return;
    for (const listener of bucket) {
      // 单个订阅者抛错不应该影响其它订阅者，也不应该中断引擎
      try {
        listener(event);
      } catch (error) {
        console.error('[eventBus] listener failed:', (error as Error).message);
      }
    }
  }

  subscriberCount(discussionId: string): number {
    return this.listeners.get(discussionId)?.size ?? 0;
  }

  reset(): void {
    this.listeners.clear();
  }
}

export const eventBus = new EventBus();
