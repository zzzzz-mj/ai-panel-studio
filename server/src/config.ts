import 'dotenv/config';
import path from 'node:path';

/**
 * 服务端配置。
 *
 * 唯一职责：把环境变量收敛成一份强类型配置。
 * 大模型 API Key 只在这里出现，且只存在于后端进程内存中。
 */

const SERVER_ROOT = path.resolve(__dirname, '..');

function readInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readFloat(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(raw ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

const apiKey = (process.env.LLM_API_KEY ?? '').trim();

/**
 * 没有 API Key 时自动降级到内置模拟引擎：
 * 保证「零配置即可完整演示 + 可跑测试」，而不是抛错。
 */
const mock = readBool(process.env.LLM_MOCK, false) || apiKey === '';

export const config = {
  serverRoot: SERVER_ROOT,
  port: readInt(process.env.PORT, 8787),
  dbPath: path.resolve(SERVER_ROOT, process.env.DB_PATH ?? './data/panel.db'),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',

  llm: {
    provider: process.env.LLM_PROVIDER ?? 'deepseek',
    apiKey,
    baseUrl: (process.env.LLM_BASE_URL ?? 'https://api.deepseek.com/v1').replace(/\/+$/, ''),
    model: process.env.LLM_MODEL ?? 'deepseek-chat',
    temperature: readFloat(process.env.LLM_TEMPERATURE, 0.9),
    timeoutMs: readInt(process.env.LLM_TIMEOUT_MS, 60_000),
    mock,
  },

  engine: {
    /** 每轮之间的节拍，用于营造「实时讨论」的节奏感 */
    turnIntervalMs: readInt(process.env.TURN_INTERVAL_MS, 900),
    /** 单场讨论最大发言条数，防止无限循环 */
    maxTurns: readInt(process.env.MAX_TURNS, 24),
  },
} as const;

export type AppConfig = typeof config;
