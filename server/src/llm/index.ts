import { config } from '../config';
import { MockEngine } from './mock';
import { OpenAiEngine } from './openai';
import type { LlmEngine } from './types';

/**
 * 引擎工厂。
 *
 * 选择逻辑只有一条：配置了 API Key 就走真实模型，否则走离线确定性引擎。
 * 上层（讨论引擎）拿到的永远是同一个 LlmEngine 接口，不关心背后是谁。
 */

let engine: LlmEngine | null = null;

export function getEngine(): LlmEngine {
  if (!engine) {
    engine = config.llm.mock ? new MockEngine() : new OpenAiEngine();
  }
  return engine;
}

/** 测试用：注入替身引擎。 */
export function setEngine(next: LlmEngine | null): void {
  engine = next;
}

export type { LlmEngine } from './types';
export * from './types';
