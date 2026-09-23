import type { PanelDraft, SpeakDecision, SynthesisResult } from '../domain/types';
import { clampSentences, cleanUtterance } from './json';
import type {
  HostCueRequest,
  LlmEngine,
  PanelRequest,
  PanelistCard,
  SpeakRequest,
  SummaryRequest,
  SynthesisRequest,
  UtteranceRequest,
} from './types';

/**
 * 离线确定性引擎。
 *
 * 存在的意义：没有 API Key 时产品依然要能完整演示、测试要能稳定断言。
 * 它不调用任何外部服务，用「立场原型 + 模板库 + 确定性伪随机」驱动讨论，
 * 因此同一份输入永远得到同一场讨论（可复现），而不同议题得到不同阵容。
 *
 * 它不是「假数据」：立场原型之间预置了真实的对立关系，共识 / 分歧是从
 * 参与者的立场组合里推出来的，而不是写死的结论。
 */

// ------------------------------------------------------------ 确定性伪随机

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32：小而稳的确定性 PRNG。 */
function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------ 立场原型

interface Archetype {
  key: string;
  title: string;
  names: string[];
  org: string;
  stance: string;
  bio: string;
  focuses: string[];
  claims: string[];
  rebuttals: string[];
  supplements: string[];
  agreements: string[];
}

const T = '{topic}';

const ARCHETYPES: Archetype[] = [
  {
    key: 'accelerationist',
    title: '技术战略研究者',
    names: ['陈启明', '周律行', '许维舟', '林砚清'],
    org: '前沿技术研究院',
    stance: `「${T}」的主要阻力来自组织惯性，而不是技术本身；不主动拥抱的一方会在三到五年内被结构性淘汰。`,
    bio: '长期为大型企业做技术路线评估，见过太多「等一等再说」最终变成「来不及」的案例。',
    focuses: ['迁移成本被系统性高估', '窗口期正在关闭', '先发者的复利效应'],
    claims: [
      `过去十年里，真正卡住「${T}」的从来不是能力上限，而是决策链条的长度。`,
      `凡是把「${T}」当成效率工具来立项的团队，最后都低估了它对组织结构本身的重塑。`,
      `现在讨论「${T}」该不该做已经没有意义，真问题是要用多快的节奏把存量能力迁过去。`,
    ],
    rebuttals: [
      `{prev}说的风险确实存在，但那些风险属于执行问题，不该被用来否决方向本身。`,
      `{prev}举的例子都来自转型失败者，这是典型的存活者偏差——失败者本来就不会出现在样本里。`,
    ],
    supplements: [
      `补一个数据：同类技术在过去几次迭代中，成本下降的斜率都远超当时最乐观的预测。`,
      `还有一层{prev}没提到——「${T}」带来的不只是效率，而是让原本不可能的产品形态变得可行。`,
    ],
    agreements: [
      `{prev}提到的约束条件是对的，但正因为约束存在，越早投入的边际收益才越高。`,
    ],
  },
  {
    key: 'precautionary',
    title: '技术风险研究员',
    names: ['沈亦舟', '顾承之', '叶知微', '邵含章'],
    org: '公共政策研究中心',
    stance: `「${T}」的真实代价往往滞后三到五年才显形，在缺乏可回退方案前，快速铺开是不负责任的。`,
    bio: '研究过多次技术事故的复盘报告，发现绝大多数事故都不是技术失效，而是责任边界没定义清楚。',
    focuses: ['不可逆的沉没成本', '责任归属缺口', '被忽略的尾部风险'],
    claims: [
      `「${T}」最危险的地方在于，它把决策权从人手里悄悄转移走了，而没有人为此负责。`,
      `我们讨论「${T}」时总在算收益，却很少算「出错之后能不能退回来」——这才是关键指标。`,
      `历史上每一次「来不及了必须上」的叙事，事后看都有一部分是被卖方创造出来的紧迫感。`,
    ],
    rebuttals: [
      `{prev}把「不行动的代价」说得太轻了，但更大的问题是：一旦铺开，纠错成本会指数级上升。`,
      `{prev}说这是执行问题，可执行问题的失败率恰恰取决于有没有留退路。`,
    ],
    supplements: [
      `我想补充一个被忽略的维度：{prev}讨论的是平均值，但「${T}」的风险集中在长尾。`,
      `还有一个结构性问题是{prev}没提到的——「${T}」的效果很难归因，出了问题也无法定位。`,
    ],
    agreements: [
      `{prev}的判断我基本认同，但需要加一个前提：必须有可验证的退出机制。`,
    ],
  },
  {
    key: 'economist',
    title: '产业经济学者',
    names: ['梁思勉', '郑允初', '何守拙', '卫知远'],
    org: '大学经济学院',
    stance: `「${T}」能不能成立，取决于激励结构而不是意愿；只要单位成本还没跨过临界点，任何推广都是补贴在支撑。`,
    bio: '做过多个行业的生产率测算，习惯把一切讨论换算成单位成本与边际收益。',
    focuses: ['单位成本临界点', '谁在承担成本', '激励错配'],
    claims: [
      `抛开成本谈「${T}」的价值没有意义，真正的分水岭是单位成本何时跨过临界点。`,
      `「${T}」现在看起来有效，很大程度上是因为早期采用者恰好是收益最高的那一小部分场景。`,
      `如果成本结构不变，「${T}」只会加剧而不是缓解现有的能力差距。`,
    ],
    rebuttals: [
      `{prev}的论证缺一个成本项：你说的收益在总账里可能被隐性成本完全吃掉。`,
      `{prev}把技术曲线当成了必然，但成本下降需要规模支撑，而规模又依赖需求——这是个循环。`,
    ],
    supplements: [
      `补充一点：{prev}忽略了「${T}」的成本由谁承担，这决定了它能否持续。`,
      `还有一个容易被忽略的账：导入「${T}」的组织会同时背上迁移与并行的双重成本。`,
    ],
    agreements: [
      `{prev}说的方向我同意，但必须补上成本口径，否则讨论会变成立场表态。`,
    ],
  },
  {
    key: 'practitioner',
    title: '一线实践者',
    names: ['方叙白', '罗青野', '乔听澜', '谢观棋'],
    org: '一线业务团队',
    stance: `关于「${T}」的理论讨论都太干净了；在一线，真正决定成败的是那些没被写进方案里的琐碎约束。`,
    bio: '每天和真实用户、真实故障打交道，对一切「理论上可行」的说法保持怀疑。',
    focuses: ['落地时的琐碎约束', '真实用户的行为偏差', '流程摩擦'],
    claims: [
      `一线看到的「${T}」和方案里写的完全是两件事，最大的成本永远花在方案没写的地方。`,
      `「${T}」在演示环境里几乎总是成功的，问题全部出在第二周以后。`,
      `用户不会按设计的方式使用「${T}」，他们会自己发明一套用法，然后反过来定义需求。`,
    ],
    rebuttals: [
      `{prev}的模型很漂亮，但我在一线没见过它成立过——至少在资源受限的场景里没有。`,
      `{prev}假设了理想执行，可现实里光是让流程改动落地就要花掉大半预算。`,
    ],
    supplements: [
      `补一个一线的例子：真正拖慢「${T}」的不是能力，是审批和交接的摩擦。`,
      `还有一点{prev}没说到：一线最怕的不是难，是方向反复变。`,
    ],
    agreements: [
      `{prev}说到了要害，我只需要补一句：一线的问题从来不是缺方法，是缺可执行的边界。`,
    ],
  },
  {
    key: 'ethicist',
    title: '科技伦理学者',
    names: ['苏怀瑾', '倪澹如', '容清让', '裴照微'],
    org: '应用伦理研究所',
    stance: `「${T}」的分配后果比它的技术能力更值得讨论；如果不先定义「谁被排除在外」，效率提升本身就是一种不公平。`,
    bio: '关注技术扩散中的分配正义问题，习惯追问「谁受益、谁承担、谁缺席」。',
    focuses: ['谁被排除在外', '分配后果', '同意与知情'],
    claims: [
      `讨论「${T}」时最容易被跳过的一步是：先问清楚谁不在场，谁的声音没被计入。`,
      `「${T}」的效率提升不会自动均分，它会沿着原有的资源分布继续放大差距。`,
      `如果「${T}」的效果无法被解释和申诉，那它带来的顺从就是被迫的。`,
    ],
    rebuttals: [
      `{prev}用效率论证「${T}」的价值，但效率从来不回答「对谁有效」这个问题。`,
      `{prev}的可行性判断里，缺了受影响者是否同意这一项。`,
    ],
    supplements: [
      `我想把讨论拉回一个前提：{prev}说的收益，在被排除的那部分人身上可能正好是反向的。`,
      `还有一个{prev}没触及的层面——「${T}」会改变人们对「正常」的定义。`,
    ],
    agreements: [
      `{prev}的分析框架我认同，但需要把分配后果显式写进去，否则它会默认消失。`,
    ],
  },
  {
    key: 'institutionalist',
    title: '制度与历史研究者',
    names: ['秦望岳', '卫既明', '柏行简', '虞承熙'],
    org: '人文与社会科学学院',
    stance: `「${T}」不是新问题，而是老问题的新外壳；先看看历史上同类变革是怎么收场的，再谈它有多特殊。`,
    bio: '研究过多次技术-制度互动的长周期案例，倾向于把当下放进更长的时间尺度里看。',
    focuses: ['历史同构案例', '制度适应速度', '长周期视角'],
    claims: [
      `把「${T}」放到五十年的尺度上看，它更像是一次制度适应问题，而不是技术跃迁。`,
      `历史上真正被新技术淘汰的，从来不是不会用工具的人，而是依赖旧规则获利的人。`,
      `每一次「${T}」这样的变革，最终稳定下来的形态都和最初宣称的完全不同。`,
    ],
    rebuttals: [
      `{prev}的判断建立在「这次不一样」上，但每一次变革时人们都是这么说的。`,
      `{prev}忽略了制度适应有固定周期，它不会因为技术更快就跟着变快。`,
    ],
    supplements: [
      `补一个历史对照：{prev}描述的现象在上一轮技术变革里几乎完整出现过。`,
      `还有一层{prev}没提到——「${T}」真正改变的是议价能力，而不是工作内容。`,
    ],
    agreements: [
      `{prev}说的机制我认可，历史上确实反复出现，但结局往往取决于制度而不是技术。`,
    ],
  },
];

const HOST = {
  name: '陆怀川',
  title: '圆桌主持人',
  stance: '负责推进讨论节奏，不预设结论，只追问论证链条中最薄弱的一环。',
  bio: '主持过多档深度对谈节目，擅长在双方各说各话时指出真正的分歧点。',
};

// ------------------------------------------------------------ 共识 / 分歧池
//
// 不是写死的结论，而是「当这些立场同时在场时，可以推断出的共识 / 对立」。
// requires / between 用原型 key 表达前提条件。

const CONSENSUS_POOL: Array<{ requires: string[]; statement: string }> = [
  {
    requires: ['accelerationist', 'precautionary'],
    statement: `双方都承认「${T}」的推进速度受制于组织与制度，而不是单纯的技术成熟度。`,
  },
  {
    requires: ['economist', 'practitioner'],
    statement: `讨论者一致认为，「${T}」的隐性成本（迁移、并行、流程摩擦）在现有方案中被系统性低估。`,
  },
  {
    requires: ['ethicist', 'institutionalist'],
    statement: `关于「${T}」的收益分配存在结构性不均，效率提升不会自动均分到所有相关方。`,
  },
  {
    requires: ['practitioner', 'economist'],
    statement: `共识是：在「${T}」的评估中必须引入成本口径与退出机制，否则讨论会退化为立场表态。`,
  },
  {
    requires: ['accelerationist', 'ethicist', 'institutionalist'],
    statement: `参与者共同确认，「${T}」的最终形态会与最初宣称的版本显著不同，需要预留调整空间。`,
  },
];

const DIVERGENCE_POOL: Array<{ between: [string, string]; statement: string; tension: string }> = [
  {
    between: ['accelerationist', 'precautionary'],
    statement: `在「${T}」是否应当「先铺开、后纠错」这一问题上，双方立场不可调和。`,
    tension: '一方认为等待的代价高于试错代价，另一方认为一旦铺开就失去了纠错能力。',
  },
  {
    between: ['economist', 'ethicist'],
    statement: `关于「${T}」的评估标准，是应该以单位成本与总收益衡量，还是必须先定义分配后果。`,
    tension: '效率口径与分配口径无法同时最优化，双方对「先回答哪个问题」存在根本分歧。',
  },
  {
    between: ['practitioner', 'institutionalist'],
    statement: `对「${T}」的阻力来源判断不同：是执行层面的琐碎摩擦，还是制度适应速度的硬约束。`,
    tension: '前者认为阻力可通过流程优化消解，后者认为阻力来自制度周期，不可被工程手段绕过。',
  },
  {
    between: ['accelerationist', 'ethicist'],
    statement: `「${T}」带来的效率提升本身是否构成正当性理由，双方给出了相反的答案。`,
    tension: '一方认为效率提升即价值，另一方认为效率不回答「对谁有效」。',
  },
  {
    between: ['precautionary', 'practitioner'],
    statement: `在「${T}」缺乏可回退方案时，一线是否应该先行试点。`,
    tension: '一方主张没有退路就不该开始，另一方认为不试点就永远拿不到真实的约束条件。',
  },
];

// ------------------------------------------------------------ 引擎实现

export class MockEngine implements LlmEngine {
  readonly mock = true;
  readonly model = 'mock-deterministic-v1';

  async generatePanel(request: PanelRequest): Promise<PanelDraft> {
    const seed = hashString(`${request.topic}|${request.expertCount}`);
    const random = makeRandom(seed);

    // 打乱原型顺序，保证不同议题拿到不同阵容；再按需截取
    const pool = [...ARCHETYPES];
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      const a = pool[i];
      const b = pool[j];
      if (a && b) {
        pool[i] = b;
        pool[j] = a;
      }
    }

    const experts = pool.slice(0, request.expertCount).map((archetype) => ({
      name: archetype.names[Math.floor(random() * archetype.names.length)] ?? archetype.names[0]!,
      title: archetype.title,
      org: archetype.org,
      stance: archetype.stance.replaceAll(T, request.topic),
      bio: archetype.bio,
    }));

    return {
      host: {
        name: HOST.name,
        title: HOST.title,
        org: 'AI Panel Studio',
        stance: HOST.stance,
        bio: HOST.bio,
      },
      experts,
    };
  }

  async hostCue(request: HostCueRequest): Promise<string> {
    const topic = request.topic;
    if (request.kind === 'opening') {
      return cleanUtterance(
        `欢迎来到本场圆桌，今天要讨论的是「${topic}」。这个问题之所以值得争论，是因为它同时牵动效率与代价，而且两边的账都不好算。先请各位亮明立场：你认为这件事最关键的判断依据是什么？`,
      );
    }
    if (request.kind === 'question') {
      const target = request.target?.name ?? '这位';
      return cleanUtterance(
        `${target}，你刚才的判断成立的前提是成本可以摊薄，但如果这个前提在真实场景里不成立，你的结论还站得住吗？`,
      );
    }
    return cleanUtterance(
      `两位的分歧其实已经很清楚了：一方看的是方向，另一方看的是退路。我们把这个分歧先记下来，继续往下问。`,
    );
  }

  async decideSpeak(request: SpeakRequest): Promise<SpeakDecision> {
    if (request.spokeThisRound.includes(request.self.id)) {
      return { wantsToSpeak: false, intent: 'claim', urgency: 0, focus: '' };
    }

    const seed = hashString(`${request.topic}|${request.round}|${request.self.id}`);
    const random = makeRandom(seed);
    const roll = random();

    // 首轮让所有嘉宾都亮一次立场；之后按确定性概率抢答，制造"非轮流"的节奏
    const wantsToSpeak = request.round <= 1 ? true : roll < 0.72;
    if (!wantsToSpeak) {
      return { wantsToSpeak: false, intent: 'claim', urgency: 0, focus: '' };
    }

    const lastSpeaker = request.recentTurns.at(-1)?.speakerName;
    const intentRoll = random();
    const intent: SpeakDecision['intent'] =
      lastSpeaker && intentRoll < 0.45 ? 'rebuttal' : intentRoll < 0.75 ? 'supplement' : 'claim';

    const archetype = findArchetypeByTitle(request.self.title);
    const focuses = archetype?.focuses ?? ['论证前提是否成立'];
    const focus = focuses[Math.floor(random() * focuses.length)] ?? focuses[0]!;

    return {
      wantsToSpeak: true,
      intent,
      urgency: Math.round(40 + random() * 55),
      focus,
    };
  }

  async composeUtterance(request: UtteranceRequest): Promise<string> {
    const archetype = findArchetypeByTitle(request.self.title);
    const topic = request.topic;
    const prev = request.recentTurns.at(-1)?.speakerName ?? '前面这位';

    if (!archetype) {
      return cleanUtterance(`关于「${topic}」，我认为关键在于把前提条件说清楚，否则讨论会停留在立场表态。`);
    }

    const seed = hashString(`${request.topic}|${request.round}|${request.self.id}|${request.decision.intent}`);
    const random = makeRandom(seed);
    const pick = (list: string[]): string => list[Math.floor(random() * list.length)] ?? list[0] ?? '';

    const raw =
      request.decision.intent === 'rebuttal'
        ? pick(archetype.rebuttals)
        : request.decision.intent === 'supplement'
          ? pick(archetype.supplements)
          : request.decision.intent === 'agree'
            ? pick(archetype.agreements)
            : pick(archetype.claims);

    return cleanUtterance(raw.replaceAll(T, topic).replaceAll('{prev}', prev));
  }

  async synthesize(request: SynthesisRequest): Promise<SynthesisResult> {
    const present = new Set(
      request.panel.map((p) => findArchetypeByTitle(p.title)?.key).filter((k): k is string => Boolean(k)),
    );
    const nameByKey = new Map<string, string>();
    for (const p of request.panel) {
      const key = findArchetypeByTitle(p.title)?.key;
      if (key) nameByKey.set(key, p.name);
    }

    // 随着轮次推进，清单逐步变长 —— 体现"实时增量更新"
    const consensusLimit = Math.min(1 + Math.floor(request.round / 2), CONSENSUS_POOL.length);
    const divergenceLimit = Math.min(1 + Math.floor((request.round + 1) / 2), DIVERGENCE_POOL.length);

    const consensus = CONSENSUS_POOL.filter((item) => item.requires.every((key) => present.has(key)))
      .slice(0, consensusLimit)
      .map((item) => ({
        statement: item.statement.replaceAll(T, request.topic),
        supporterNames: item.requires.filter((key) => present.has(key)).map((key) => nameByKey.get(key) ?? '').filter(Boolean),
      }));

    const divergence = DIVERGENCE_POOL.filter((item) => item.between.every((key) => present.has(key)))
      .slice(0, divergenceLimit)
      .map((item) => ({
        statement: item.statement.replaceAll(T, request.topic),
        supporterNames: item.between.map((key) => nameByKey.get(key) ?? '').filter(Boolean),
        tension: item.tension,
      }));

    return { consensus, divergence };
  }

  async composeSummary(request: SummaryRequest): Promise<string> {
    const topic = request.topic;
    const consensus = request.insights.filter((i) => i.kind === 'consensus');
    const divergence = request.insights.filter((i) => i.kind === 'divergence');
    const speakerNames = Array.from(new Set(request.transcript.map((t) => t.speakerName)));

    const parts: string[] = [];
    parts.push(
      `关于「${topic}」，我们这一场讨论请到了 ${request.panel.length} 位嘉宾，${speakerNames.length} 位发表了意见。`,
    );

    if (consensus.length > 0) {
      parts.push(
        `先说要紧的共识。大家在这一点上基本站到了一起：${consensus.map((c) => c.statement).join('；')}`,
      );
    } else {
      parts.push('坦白说，今天没有形成太多共识，这本身就是这场讨论最有价值的信息。');
    }

    if (divergence.length > 0) {
      const who = Array.from(new Set(divergence.flatMap((d) => d.supporterNames))).join('、');
      parts.push(
        `仍然悬置的分歧也很清楚：${divergence.map((d) => d.statement).join('；')}。${who ? `${who}在这个问题上没有谈拢。` : ''}`,
      );
    }

    parts.push(
      '如果只带走一句话：判断这件事时，先问清楚你用的是效率的口径还是分配的口径——口径不同，结论就不会相同。感谢各位，本场讨论到此结束。',
    );

    return clampSentences(parts.join(''), 99, 1000);
  }
}

function findArchetypeByTitle(title: string): Archetype | undefined {
  return ARCHETYPES.find((item) => item.title === title);
}

/** 供测试与 seed 复用：原型与池的只读视图。 */
export const mockCatalog = {
  archetypes: ARCHETYPES,
  consensusPool: CONSENSUS_POOL,
  divergencePool: DIVERGENCE_POOL,
  host: HOST,
};
