import { type Db, createMemoryDb, setDb } from '../src/db';
import { Repo, setRepo } from '../src/db/repo';
import { eventBus } from '../src/engine/eventBus';
import { resetRuntimes } from '../src/engine/orchestrator';

/**
 * 测试夹具：每个用例拿到一个干净的内存库 + 全新的 Repo。
 *
 * 之所以必须显式 setDb / setRepo：路由与引擎都是通过模块级单例取依赖的，
 * 测试里把它们指向内存库，就能做到「零文件残留、用例之间完全隔离」。
 */
export function freshRepo(): { repo: Repo; db: Db } {
  const db = createMemoryDb();
  const repo = new Repo(db);
  setDb(db);
  setRepo(repo);
  eventBus.reset();
  return { repo, db };
}

export function teardown(): void {
  resetRuntimes();
  eventBus.reset();
  setRepo(null);
  setDb(null);
}

/** 轮询等待某场讨论结束（e2e 用）。 */
export async function waitFor(
  probe: () => Promise<string>,
  predicate: (status: string) => boolean,
  timeoutMs = 25_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate(await probe())) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`等待超时（${timeoutMs}ms）：状态未满足条件`);
}
