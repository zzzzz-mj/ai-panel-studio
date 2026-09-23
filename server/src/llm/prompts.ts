import type {
  HostCueRequest,
  PanelRequest,
  SpeakRequest,
  SummaryRequest,
  SynthesisRequest,
  UtteranceRequest,
} from './types';

/**
 * 提示词集中管理。
 *
 * 设计原则（对应 docs/WORKFLOW.md）：
 * 1. 每个任务只给模型「完成这件事所必需」的上下文，绝不给全量 transcript。
 * 2. 结构化输出一律要求 JSON，且明确禁止 Markdown 代码块与解释性文字。
 * 3. 对「容易退化成机械轮流发言 / 空话套话」的地方写死硬性约束。
 */

const JSON_ONLY = '只输出 JSON，不要输出解释、Markdown 代码块或任何额外文字。';

export const SYSTEM_PANEL_ARCHITECT = '你是一位资深的圆桌论坛策划人，擅长为争议性议题设计立场对立、彼此能真正辩起来的嘉宾阵容。';

export function panelPrompt(request: PanelRequest): string {
  return [
    `议题：${request.topic}`,
    request.background ? `背景与约束：${request.background}` : '背景与约束：（未提供）',
    `需要 ${request.expertCount} 位专家 + 1 位主持人。`,
    '',
    '硬性要求：',
    '1. 每位专家必须代表一个**真实存在的立场分歧**，彼此之间要有可辩论的张力；禁止观点雷同或互相附和。',
    '2. 至少有一位专家的立场要刻意与主流直觉相反（为少数派观点做强论证），避免全体一边倒。',
    '3. title 必须具体到学科或职业（如「组织行为学教授」「三线城市中学班主任」），禁止使用「专家」「学者」这类空泛头衔。',
    '4. stance 是该嘉宾的核心主张，一句话，必须带明确倾向性；禁止出现「中立客观」「各有优劣」这类无立场表述。',
    '5. bio 一句话交代其立场来源（研究经历 / 一线经验 / 利益相关方身份）。',
    '6. 姓名使用符合中文语境的中文姓名，主持人姓名不要与专家重复。',
    '',
    '输出 JSON 结构：',
    '{"host":{"name":"","title":"","org":"","stance":"","bio":""},"experts":[{"name":"","title":"","org":"","stance":"","bio":""}]}',
    JSON_ONLY,
  ].join('\n');
}

export function hostCuePrompt(request: HostCueRequest): string {
  const recent = renderTurns(request.recentTurns.slice(-6));
  const board = renderInsights(request.insights);
  const roster = request.panel
    .map((p) => `- ${p.name}（${p.title}）：${p.stance}`)
    .join('\n');

  const task =
    request.kind === 'opening'
      ? '请说出本场讨论的开场白。先用一句话点明议题为什么值得争论，再明确抛出第一个问题。'
      : request.kind === 'question'
        ? `请针对 ${request.target?.name ?? '某位嘉宾'} 刚才的发言做一次追问。追问必须指向其论证中最薄弱或最未展开的一点，而不是笼统地"请再展开说说"。`
        : '请用一句话串联刚刚的发言，指出双方真正的分歧点在哪里，然后引出下一位发言。';

  return [
    `你是本场圆桌的主持人 ${request.host.name}（${request.host.title}）。`,
    `议题：${request.topic}`,
    request.background ? `背景与约束：${request.background}` : '',
    `当前阶段：${request.phase}，第 ${request.round} 轮。`,
    '',
    '嘉宾阵容：',
    roster,
    '',
    recent ? `最近发言：\n${recent}` : '最近发言：（讨论尚未开始）',
    '',
    board ? `当前共识 / 分歧：\n${board}` : '',
    '',
    `任务：${task}`,
    '',
    '硬性约束：',
    '- 中文，最多 2 句，每句不超过 50 字。',
    '- 主持人只负责推进讨论，不得替嘉宾表态，也不得输出自己的观点结论。',
    '- 不要复述嘉宾原话，不要使用"让我们""接下来"之外的套话。',
    '- 直接输出这段话本身，不要加引号、不要加姓名前缀、不要输出 JSON。',
  ]
    .filter(Boolean)
    .join('\n');
}

export function speakPrompt(request: SpeakRequest): string {
  return [
    `你正在扮演圆桌讨论中的嘉宾 ${request.self.name}（${request.self.title}）。`,
    `你的核心立场：${request.self.stance}`,
    `你的背景：${request.self.bio}`,
    `议题：${request.topic}`,
    request.background ? `背景与约束：${request.background}` : '',
    `当前阶段：${request.phase}，第 ${request.round} 轮。`,
    '',
    `最近发言：\n${renderTurns(request.recentTurns.slice(-8)) || '（你是第一位发言者）'}`,
    '',
    request.insights.length > 0 ? `当前共识 / 分歧：\n${renderInsights(request.insights)}` : '',
    '',
    '判断你现在是否要主动发言：',
    '- 只有当你能针对最近的发言提出**新的、属于你立场的信息或反驳**时才发言；如果没有增量，就选择不发言。',
    '- 优先选择 rebuttal（反驳与你立场冲突的判断）或 supplement（补充你独有的论据）。',
    '- agree（附和）只在你能补充新证据支撑时才用，禁止单纯复读别人的话。',
    '- urgency 表示抢答优先级，0-100，观点冲突越尖锐越高。',
    '- focus 是一句话的「当前关注点」，会被展示给观众，禁止写成内心推理过程。',
    '',
    '输出 JSON：{"wantsToSpeak":true,"intent":"claim|rebuttal|supplement|agree","urgency":0,"focus":""}',
    JSON_ONLY,
  ]
    .filter(Boolean)
    .join('\n');
}

export function utterancePrompt(request: UtteranceRequest): string {
  const intentGuide: Record<string, string> = {
    claim: '亮出你自己的主张，给出一个具体的理由或证据。',
    rebuttal: '直接反驳上一位发言者的某个具体判断，指出它在什么条件下不成立。',
    supplement: '补充一个上一位发言者没有提到、但属于你立场的论据。',
    agree: '认同上一位发言者的判断，并补上一个能加强它的新证据。',
  };

  return [
    `你正在扮演圆桌讨论中的嘉宾 ${request.self.name}（${request.self.title}）。`,
    `你的核心立场：${request.self.stance}`,
    `你的背景：${request.self.bio}`,
    `议题：${request.topic}`,
    `当前阶段：${request.phase}，第 ${request.round} 轮。`,
    '',
    `最近发言：\n${renderTurns(request.recentTurns.slice(-8)) || '（你是第一位发言者）'}`,
    request.roundSoFar.length > 0 ? `\n本轮已发言（禁止与之重复）：\n${renderTurns(request.roundSoFar)}` : '',
    '',
    `本轮你的发言意图：${request.decision.intent} —— ${intentGuide[request.decision.intent] ?? ''}`,
    '',
    '硬性约束：',
    '- 必须点名回应上一位发言者的**具体判断**，不能自说自话。',
    '- 禁止重复自己此前已经表达过的观点，必须提供新的信息、条件或反例。',
    '- 禁止使用「作为一个AI」「我认为这是一个复杂的问题」这类空话。',
    '- 最多 2 句，每句不超过 60 字，口语化，像真人说话。',
    '- 直接输出这段发言，不要加引号、不要加姓名前缀、不要输出 JSON。',
  ]
    .filter(Boolean)
    .join('\n');
}

export function synthesisPrompt(request: SynthesisRequest): string {
  return [
    '你是圆桌讨论的实时纪要员。请从当前讨论中提炼「共识」与「分歧」。',
    `议题：${request.topic}`,
    request.background ? `背景与约束：${request.background}` : '',
    `当前轮次：第 ${request.round} 轮`,
    '',
    `嘉宾名单（supporterNames 只能取自这份名单）：\n${request.panel.map((p) => `- ${p.name}（${p.title}）`).join('\n')}`,
    '',
    request.previous.length > 0
      ? `此前已确认的条目（未变化的必须逐字沿用 statement，不要改写）：\n${renderInsights(request.previous)}`
      : '此前已确认的条目：（无）',
    '',
    `当前 transcript：\n${renderTurns(request.transcript)}`,
    '',
    '规则：',
    '- consensus：至少 2 位嘉宾明确认同的结论。',
    '- divergence：尚未解决的对立观点，tension 一句话描述对立点在哪里。',
    '- 返回**完整清单**（含此前已确认且仍然成立的条目）。',
    '- statement 必须具体到可直接引用，禁止「大家有不同看法」「需要综合考虑」这类空话。',
    '- supporterNames 只包含**明确表达过该立场**的嘉宾，不要凭印象添加。',
    '- consensus 与 divergence 各最多 5 条。',
    '',
    '输出 JSON：{"consensus":[{"statement":"","supporterNames":[],"tension":""}],"divergence":[{"statement":"","supporterNames":[],"tension":""}]}',
    JSON_ONLY,
  ]
    .filter(Boolean)
    .join('\n');
}

export function summaryPrompt(request: SummaryRequest): string {
  return [
    `你是本场圆桌的主持人，讨论即将结束，请做收尾总结。`,
    `议题：${request.topic}`,
    request.background ? `背景与约束：${request.background}` : '',
    '',
    `嘉宾阵容：\n${request.panel.map((p) => `- ${p.name}（${p.title}）：${p.stance}`).join('\n')}`,
    '',
    `讨论达成的共识 / 分歧：\n${renderInsights(request.insights) || '（无）'}`,
    '',
    `完整 transcript：\n${renderTurns(request.transcript)}`,
    '',
    '要求：',
    '- 用主持人第一人称口吻，像节目收尾一样自然过渡，不要写成分析报告。',
    '- 150-250 字。先概括本次讨论真正达成的共识，再点出仍然悬置的分歧及其分歧点。',
    '- 明确指出哪几位嘉宾在哪个问题上没有达成一致，但不要评判谁对谁错。',
    '- 最后用一句话给听众一个可带走的判断框架。',
    '- 直接输出总结正文，禁止输出 JSON、Markdown、标题或任何结构化标记。',
  ]
    .filter(Boolean)
    .join('\n');
}

// ------------------------------------------------------------ 渲染辅助

function renderTurns(turns: Array<{ speakerName: string; speakerTitle: string; intent: string; content: string }>): string {
  return turns.map((t) => `${t.speakerName}（${t.speakerTitle}）[${t.intent}]：${t.content}`).join('\n');
}

function renderInsights(insights: Array<{ kind: string; statement: string; supporterNames: string[]; tension: string | null }>): string {
  if (insights.length === 0) return '';
  return insights
    .map((i) => {
      const label = i.kind === 'consensus' ? '共识' : '分歧';
      const who = i.supporterNames.length > 0 ? `（${i.supporterNames.join('、')}）` : '';
      const tension = i.tension ? ` ｜ 张力：${i.tension}` : '';
      return `- [${label}] ${i.statement}${who}${tension}`;
    })
    .join('\n');
}
