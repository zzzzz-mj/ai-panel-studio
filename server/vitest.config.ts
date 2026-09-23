import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 每个测试文件使用独立进程，避免共享 SQLite 连接互相污染
    pool: 'forks',
    testTimeout: 30000,
    hookTimeout: 30000,
    env: {
      // 测试必须走离线确定性引擎，且去掉「讨论节拍」的等待，让整场讨论秒级跑完
      LLM_MOCK: 'true',
      LLM_API_KEY: '',
      TURN_INTERVAL_MS: '0',
      MAX_TURNS: '80',
    },
  },
});
