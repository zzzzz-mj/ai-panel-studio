import { config } from '../config';
import type { PanelDraft, SpeakDecision, SynthesisResult } from '../domain/types';
import {
  asBool,
  asEnum,
  asNumber,
  asObjectArray,
  asString,
  asStringArray,
  cleanUtterance,
  extractJson,
} from './json';
import {
  SYSTEM_PANEL_ARCHITECT,
  hostCuePrompt,
  panelPrompt,
  speakPrompt,
  summaryPrompt,
  synthesisPrompt,
  utterancePrompt,
} from './prompts';
import type {
  HostCueRequest,
  LlmEngine,
  PanelRequest,
  SpeakRequest,
  SummaryRequest,
  SynthesisRequest,
  UtteranceRequest,
} from './types';

/**
 * 真实模型实现：任何 OpenAI 兼容的 /chat/completions 端点（DeepSeek、OpenAI、自建网关）。
 *
 * 安全约束：apiKey 只从 config（环境变量）读取，只出现在请求头里，
 * 不写日志、不回传给调用方、不进入任何前端可见的响应。
 */

const INTENTS = ['claim', 'rebuttal', 'supplement', 'agree'] as const;

interface ChatOptions {
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
}

export class OpenAiEngine implements LlmEngine {
  readonly mock = false;
  readonly model = config.llm.model;

  private async chat(messages: Array<{ role: 'system' | 'user'; content: string }>, options: ChatOptions = {}): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.llm.timeoutMs);
    try {
      const response = await fetch(`${config.llm.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.llm.apiKey}`,
        },
        body: JSON.stringify({
          model: config.llm.model,
          messages,
          temperature: options.temperature ?? config.llm.temperature,
          max_tokens: options.maxTokens ?? 1024,
          ...(options.json ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // 只暴露状态码与截断后的正文，绝不回显请求头（含密钥）
        const body = await response.text().catch(() => '');
        throw new Error(`LLM 请求失败 ${response.status}: ${body.slice(0, 300)}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return data.choices?.[0]?.message?.content ?? '';
    } finally {
      clearTimeout(timer);
    }
  }

  async generatePanel(request: PanelRequest): Promise<PanelDraft> {
    const raw = await this.chat(
      [
        { role: 'system', content: SYSTEM_PANEL_ARCHITECT },
        { role: 'user', content: panelPrompt(request) },
      ],
      { json: true, maxTokens: 1600 },
    );

    const parsed = extractJson<Record<string, unknown>>(raw);
    if (!parsed) throw new Error('阵容生成失败：模型未返回可解析的 JSON');

    const host = normalizeMember(parsed.host, request.topic, 'host');
    const experts = asObjectArray(parsed.experts)
      .map((item, index) => normalizeMember(item, request.topic, `expert-${index}`))
      .filter((item) => item.name !== '');

    if (experts.length === 0) throw new Error('阵容生成失败：模型未返回任何专家');

    return { host, experts: experts.slice(0, request.expertCount) };
  }

  async hostCue(request: HostCueRequest): Promise<string> {
    const raw = await this.chat(
      [
        { role: 'system', content: SYSTEM_PANEL_ARCHITECT },
        { role: 'user', content: hostCuePrompt(request) },
      ],
      { maxTokens: 220 },
    );
    return cleanUtterance(raw);
  }

  async decideSpeak(request: SpeakRequest): Promise<SpeakDecision> {
    const raw = await this.chat(
      [
        { role: 'system', content: SYSTEM_PANEL_ARCHITECT },
        { role: 'user', content: speakPrompt(request) },
      ],
      { json: true, maxTokens: 240, temperature: 0.6 },
    );

    const parsed = extractJson<Record<string, unknown>>(raw);
    if (!parsed) return { wantsToSpeak: false, intent: 'claim', urgency: 0, focus: '' };

    return {
      wantsToSpeak: asBool(parsed.wantsToSpeak, false),
      intent: asEnum(parsed.intent, INTENTS, 'claim'),
      urgency: asNumber(parsed.urgency, 0, 0, 100),
      focus: asString(parsed.focus, ''),
    };
  }

  async composeUtterance(request: UtteranceRequest): Promise<string> {
    const raw = await this.chat(
      [
        { role: 'system', content: SYSTEM_PANEL_ARCHITECT },
        { role: 'user', content: utterancePrompt(request) },
      ],
      { maxTokens: 220 },
    );
    return cleanUtterance(raw);
  }

  async synthesize(request: SynthesisRequest): Promise<SynthesisResult> {
    const raw = await this.chat(
      [
        { role: 'system', content: SYSTEM_PANEL_ARCHITECT },
        { role: 'user', content: synthesisPrompt(request) },
      ],
      { json: true, maxTokens: 1200, temperature: 0.4 },
    );

    const parsed = extractJson<Record<string, unknown>>(raw);
    if (!parsed) return { consensus: [], divergence: [] };

    const pick = (key: 'consensus' | 'divergence') =>
      asObjectArray(parsed[key])
        .map((item) => ({
          statement: asString(item.statement),
          supporterNames: asStringArray(item.supporterNames),
          tension: asString(item.tension) || undefined,
        }))
        .filter((item) => item.statement !== '')
        .slice(0, 5);

    return { consensus: pick('consensus'), divergence: pick('divergence') };
  }

  async composeSummary(request: SummaryRequest): Promise<string> {
    const raw = await this.chat(
      [
        { role: 'system', content: SYSTEM_PANEL_ARCHITECT },
        { role: 'user', content: summaryPrompt(request) },
      ],
      { maxTokens: 700, temperature: 0.7 },
    );
    // 总结是自然语言，不做 2 句截断，只清掉可能残留的 JSON 围栏
    return raw.replace(/```[\s\S]*?```/g, (m) => m.replace(/```(?:json|markdown)?/gi, '')).trim();
  }
}

function normalizeMember(
  value: unknown,
  topic: string,
  fallbackKey: string,
): { name: string; title: string; org?: string; stance: string; bio: string } {
  const obj = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  return {
    name: asString(obj.name, fallbackKey === 'host' ? '主持人' : ''),
    title: asString(obj.title, '独立研究者'),
    org: asString(obj.org) || undefined,
    stance: asString(obj.stance, `围绕「${topic}」持保留态度，认为需要更多实证`),
    bio: asString(obj.bio, '长期关注该议题的独立观察者。'),
  };
}
