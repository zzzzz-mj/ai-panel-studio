import fs from 'node:fs';
import { config } from '../config';
import { closeDb, getDb } from './index';
import { getRepo } from './repo';
import { seedDatabase } from './seed';

/**
 * 重置数据库：删除 SQLite 文件（含 WAL / SHM）后重建 schema 并灌入样例数据。
 * 用于「把演示环境恢复成干净状态」。
 */

function run(): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${config.dbPath}${suffix}`;
    if (fs.existsSync(file)) {
      fs.rmSync(file);
      console.log(`[reset] 已删除 ${file}`);
    }
  }

  getDb();
  const repo = getRepo();
  const result = seedDatabase(repo, { force: true });
  console.log(`[reset] 重建完成：预置议题 ${result.presets} 条，样例讨论 ${result.discussions} 场`);
  closeDb();
}

if (require.main === module) {
  run();
}
