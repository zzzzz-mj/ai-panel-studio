import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config';

/**
 * SQLite 连接与 schema 初始化。
 *
 * 单例连接：better-sqlite3 是同步 API，本地单进程场景下最省事也最可靠。
 * 每次启动都会执行一遍 schema.sql（全部 IF NOT EXISTS，幂等）。
 */

export type Db = Database.Database;

let db: Db | null = null;

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

export function initSchema(database: Db): void {
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  database.exec(sql);
}

export function getDb(): Db {
  if (db) return db;

  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  return db;
}

/** 测试用：在内存里开一个干净的库。 */
export function createMemoryDb(): Db {
  const memory = new Database(':memory:');
  memory.pragma('foreign_keys = ON');
  initSchema(memory);
  return memory;
}

/** 测试用：把连接指向外部传入的库，避免每个测试文件重复打开文件。 */
export function setDb(database: Db | null): void {
  db = database;
}

export function closeDb(): void {
  db?.close();
  db = null;
}
