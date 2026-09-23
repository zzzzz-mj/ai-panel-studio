import { closeDb, getDb } from './index';
import { type Repo, getRepo } from './repo';
import { HOST_COLOR } from '../services/panelService';
import { pickColor } from '../util/palette';
import type { Intent, Phase, PresetTopic, SynthesisResult } from '../domain/types';

/**
 * 样例数据。
 *
 * 两类内容：
 * 1. 预置议题库（6 条）：含议题 + 背景 + 建议嘉宾阵容，首页「一键体验」用。
 * 2. 已物化的讨论（3 场）：1 场 ready（点开就能开始）、2 场 ended（含完整
 *    transcript / 共识分歧 / 主持人总结，用于演示回放与首页有内容可看）。
 *
 * 关键点：样例讨论不是直接写 SQL 塞进去的，而是走 repo 的正常写入路径
 * （createDiscussion → replacePanelists → appendTranscript → reconcileInsights）。
 * 这等于在 seed 阶段就把整条数据链路跑通了一遍，schema 一旦写错会立刻暴露。
 */

interface MemberSpec {
  name: string;
  title: string;
  org?: string;
  stance: string;
  bio: string;
}

interface PresetSpec extends Omit<PresetTopic, 'suggestedPanel'> {
  suggestedPanel: MemberSpec[];
}

const PRESETS: PresetSpec[] = [
  {
    id: 'ai-education',
    topic: 'AI 是否会取代中小学教师？',
    background: '面向 K12 场景，需同时考虑教学效果、师生关系与教育公平',
    expertCount: 4,
    tags: ['教育', 'AI 伦理', '公共政策'],
    suggestedPanel: [
      {
        name: '沈亦舟',
        title: '教育技术学教授',
        org: '师范大学教育学部',
        stance: 'AI 会取代的是"讲授"这个环节，但教师的核心价值在关系与判断，不会被取代。',
        bio: '主持过多个省级智慧课堂试点，发现技术落地效果与预期差距最大的是师生互动环节。',
      },
      {
        name: '罗青野',
        title: '县城中学班主任',
        org: '某县级中学',
        stance: '在我们这样的学校，AI 不是取代教师，而是先把教师之间的差距放大。',
        bio: '带过三届毕业班，亲眼见过设备到位之后因为没人会用而长期闲置。',
      },
      {
        name: '梁思勉',
        title: '教育经济学者',
        org: '大学经济学院',
        stance: '只要师生比不改变，AI 就只是把教师的负担重新分配，而不是减少。',
        bio: '测算过多地教育投入产出比，习惯把教学改革折算成单位人力成本。',
      },
      {
        name: '苏怀瑾',
        title: '教育伦理研究者',
        org: '应用伦理研究所',
        stance: '如果 AI 承担了评价职能，那它就在事实上决定了孩子的机会，这件事不能只由技术决定。',
        bio: '关注教育场景中的算法分配正义，追问"谁被系统判定为不适合"。',
      },
    ],
  },
  {
    id: 'remote-work',
    topic: '远程办公是否会削弱团队的创新能力？',
    background: '面向 200 人规模的软件团队，已有两年混合办公经验',
    expertCount: 4,
    tags: ['组织管理', '协作'],
    suggestedPanel: [
      {
        name: '郑允初',
        title: '组织行为学教授',
        org: '商学院',
        stance: '削弱创新的不是远程，而是把远程做成了"每个人各自在家办公"。',
        bio: '研究过数十个分布式团队的协作模式，发现偶发碰撞才是创新的主要来源。',
      },
      {
        name: '方叙白',
        title: '研发团队负责人',
        org: '一家 200 人规模的软件公司',
        stance: '混合办公两年后，我们的交付效率涨了，但真正的新想法确实变少了。',
        bio: '亲历了公司从全员到岗到混合办公的完整转变，手里有前后对比数据。',
      },
      {
        name: '陈启明',
        title: '技术战略研究者',
        org: '前沿技术研究院',
        stance: '把创新归因于物理同处一室，是一种浪漫化的怀旧，协作工具已经补上了大部分缺口。',
        bio: '长期评估远程协作工具的实际效能，认为组织惯性常被误认为空间限制。',
      },
      {
        name: '倪澹如',
        title: '劳动社会学研究者',
        org: '社会学系',
        stance: '远程办公真正改变的是议价结构：谁被看见，谁就更容易获得机会。',
        bio: '关注远程工作对职场公平的影响，尤其是新人与边缘岗位的处境。',
      },
    ],
  },
  {
    id: 'open-source',
    topic: '开源项目的商业化是否必然以社区信任为代价？',
    background: '以近年多个知名开源项目更改许可证为背景',
    expertCount: 4,
    tags: ['开源', '商业模式', '法律'],
    suggestedPanel: [
      {
        name: '许维舟',
        title: '开源项目 Maintainer',
        org: '一个百万级 star 的基础库',
        stance: '没有可持续的收入，社区信任根本撑不到需要被考验的那一天。',
        bio: '全职维护开源项目六年，经历过两次商业化尝试与一次大规模社区分裂。',
      },
      {
        name: '裴照微',
        title: '知识产权律师',
        org: '科技法律事务所',
        stance: '许可证变更是合法权利，真正破坏信任的是变更前没有充分沟通。',
        bio: '处理过多起开源许可证纠纷，认为法律问题往往只是信任问题的表象。',
      },
      {
        name: '秦望岳',
        title: '技术史研究者',
        org: '人文与社会科学学院',
        stance: '开源社区的历史就是不断分裂又重组的历史，商业化只是其中一次外力。',
        bio: '研究过自由软件运动三十年的组织形态变迁。',
      },
      {
        name: '梁思勉',
        title: '产业经济学者',
        org: '大学经济学院',
        stance: '开源的生产关系里缺少一个定价机制，所以商业化必然表现为某种形式的"背叛"。',
        bio: '从激励结构角度分析过公共品的供给困境。',
      },
    ],
  },
  {
    id: 'attention',
    topic: '短视频是否正在重塑年轻人的注意力结构？',
    background: '讨论应区分"使用时长"与"注意力能力"两个层面',
    expertCount: 4,
    tags: ['媒介', '认知科学', '社会'],
    suggestedPanel: [
      {
        name: '叶知微',
        title: '认知神经科学研究者',
        org: '脑科学研究院',
        stance: '目前没有足够证据表明短视频造成了注意力能力的不可逆损伤，相关研究普遍混淆了相关与因果。',
        bio: '做过短视频使用与持续注意力任务的对照实验，结论比舆论谨慎得多。',
      },
      {
        name: '乔听澜',
        title: '中学语文教师',
        org: '市重点中学',
        stance: '我不需要论文，我只需要看学生读完一篇八百字文章需要几次才能读进去。',
        bio: '从教十二年，直观感受到学生长文本阅读耐受力在下降。',
      },
      {
        name: '容清让',
        title: '媒介研究者',
        org: '新闻与传播学院',
        stance: '注意力结构一直在变，印刷术、电视都曾被指责摧毁注意力，这次也许只是又一次道德恐慌。',
        bio: '研究媒介变迁史，对每一代"技术毁掉一代人"的叙事保持警惕。',
      },
      {
        name: '柏行简',
        title: '产品设计从业者',
        org: '内容平台',
        stance: '问题不在用户，在于推荐系统的优化目标本身就是停留时长，而不是用户的事后满意度。',
        bio: '参与过推荐策略设计，清楚目标函数如何反过来塑造产品形态。',
      },
    ],
  },
  {
    id: 'four-day-week',
    topic: '四天工作制应该被立法强制推行吗？',
    background: '已有多个国家与地区开展试点，结果差异较大',
    expertCount: 4,
    tags: ['劳动政策', '经济学'],
    suggestedPanel: [
      {
        name: '卫知远',
        title: '劳动经济学者',
        org: '大学经济学院',
        stance: '试点样本严重自选择，愿意参加试点的企业本来效率就高，不能据此立法。',
        bio: '做过多个工时改革试点的计量评估，习惯先看样本偏差。',
      },
      {
        name: '谢观棋',
        title: '制造业厂长',
        org: '中型精密制造企业',
        stance: '在产线场景里，工时就是产能，一刀切立法只会让订单流向没有这条法律的地方。',
        bio: '管理过三班倒的产线，清楚"可压缩工时"的岗位其实很有限。',
      },
      {
        name: '倪澹如',
        title: '劳动社会学研究者',
        org: '社会学系',
        stance: '不立法的话，四天工作制只会变成高议价能力岗位的专属福利。',
        bio: '研究过弹性工作制在不同职业群体间的分布差异。',
      },
      {
        name: '何守拙',
        title: '公共政策研究者',
        org: '政策研究中心',
        stance: '立法不是唯一工具，先改考核方式比直接改工时更有效。',
        bio: '参与过地方工时政策评估，倾向于先动约束条件再动硬性指标。',
      },
    ],
  },
  {
    id: 'ai-copyright',
    topic: 'AI 生成内容的版权应该归属于谁？',
    background: '涉及训练数据来源、生成过程贡献与最终使用者三方',
    expertCount: 4,
    tags: ['法律', 'AI 伦理', '创作者权益'],
    suggestedPanel: [
      {
        name: '裴照微',
        title: '知识产权律师',
        org: '科技法律事务所',
        stance: '现有版权法保护的是人的独创性表达，把权利给模型或给提示词使用者都缺乏法理基础。',
        bio: '代理过数起生成内容权属争议，认为立法空白不该由个案判决来填。',
      },
      {
        name: '顾承之',
        title: '插画创作者',
        org: '自由职业',
        stance: '如果训练数据包含我的作品而没有授权，那讨论"归属"本身就是在转移话题。',
        bio: '作品被大量用于训练却从未被征询，认为真正的问题是输入端而非输出端。',
      },
      {
        name: '秦望岳',
        title: '技术史研究者',
        org: '人文与社会科学学院',
        stance: '摄影术诞生时也经历过同样的争论，最后稳定下来的规则是保护具体表达而非风格。',
        bio: '研究过摄影与版权制度的百年互动史。',
      },
      {
        name: '苏怀瑾',
        title: '科技伦理学者',
        org: '应用伦理研究所',
        stance: '归属问题背后是谁有权决定使用条件，创作者的同意权比版权归属更紧迫。',
        bio: '关注生成式技术中的知情同意与利益分配机制。',
      },
    ],
  },
];

// ------------------------------------------------------------ 已物化样例

interface TranscriptSpec {
  speaker: string;
  intent: Intent;
  round: number;
  phase: Phase;
  content: string;
}

interface SampleSpec {
  topic: string;
  background: string;
  expertCount: number;
  status: 'ready' | 'ended';
  host: MemberSpec;
  experts: MemberSpec[];
  transcript?: TranscriptSpec[];
  synthesis?: SynthesisResult;
  summary?: string;
}

const HOST_SPEC: MemberSpec = {
  name: '陆怀川',
  title: '圆桌主持人',
  org: 'AI Panel Studio',
  stance: '负责推进讨论节奏，不预设结论，只追问论证链条中最薄弱的一环。',
  bio: '主持过多档深度对谈节目，擅长在双方各说各话时指出真正的分歧点。',
};

const SAMPLES: SampleSpec[] = [
  {
    topic: '远程办公是否会削弱团队的创新能力？',
    background: '面向 200 人规模的软件团队，已有两年混合办公经验',
    expertCount: 4,
    status: 'ready',
    host: HOST_SPEC,
    experts: PRESETS[1]!.suggestedPanel,
  },
  {
    topic: 'AI 是否会取代中小学教师？',
    background: '面向 K12 场景，需同时考虑教学效果、师生关系与教育公平',
    expertCount: 4,
    status: 'ended',
    host: HOST_SPEC,
    experts: PRESETS[0]!.suggestedPanel,
    transcript: [
      {
        speaker: '陆怀川',
        intent: 'open',
        round: 0,
        phase: 'opening',
        content:
          '欢迎来到本场圆桌。今天要讨论的是「AI 是否会取代中小学教师」。这个问题之所以值得争论，是因为它同时牵动教学效果与教育公平，而两边的账都不好算。先请各位亮明立场。',
      },
      {
        speaker: '沈亦舟',
        intent: 'claim',
        round: 1,
        phase: 'exploration',
        content:
          '我的判断是：AI 会取代的是「讲授」这个环节，但教师的核心价值在关系与临场判断，这部分不会被取代。',
      },
      {
        speaker: '罗青野',
        intent: 'rebuttal',
        round: 1,
        phase: 'exploration',
        content:
          '沈教授，你说的关系价值在我们学校恰恰是最先被牺牲的。设备到位之后没人会用，闲置两年，最后是教师自己加班补上。',
      },
      {
        speaker: '梁思勉',
        intent: 'supplement',
        round: 1,
        phase: 'exploration',
        content:
          '补一个成本视角：只要师生比不变，AI 就只是把教师的负担重新分配，而不是减少。总工作量没有下降。',
      },
      {
        speaker: '苏怀瑾',
        intent: 'supplement',
        round: 1,
        phase: 'exploration',
        content:
          '我更关心的是评价环节。如果 AI 承担了评价职能，它就在事实上决定了孩子的机会，这件事不能只交给技术方案来决定。',
      },
      {
        speaker: '陆怀川',
        intent: 'question',
        round: 2,
        phase: 'conflict',
        content:
          '罗老师，你刚才说设备闲置两年，这个判断成立的前提是学校没有配套的培训预算。如果这个前提被解决了，你的结论还站得住吗？',
      },
      {
        speaker: '罗青野',
        intent: 'rebuttal',
        round: 2,
        phase: 'conflict',
        content:
          '培训预算解决的是会不会用，但真正的问题是用完之后谁来负责。一线最怕的不是难，是方向反复变。',
      },
      {
        speaker: '沈亦舟',
        intent: 'rebuttal',
        round: 2,
        phase: 'conflict',
        content:
          '我同意方向反复是问题，但那是执行问题，不该被用来否决方向本身。而且存量教师的负担正是 AI 应该优先解决的部分。',
      },
      {
        speaker: '梁思勉',
        intent: 'supplement',
        round: 2,
        phase: 'conflict',
        content:
          '两位的分歧其实在成本口径上。沈教授算的是边际收益，罗老师算的是总投入，口径不同结论就不会相同。',
      },
      {
        speaker: '陆怀川',
        intent: 'bridge',
        round: 3,
        phase: 'conflict',
        content: '两位的分歧已经很清楚了：一方看的是方向，另一方看的是退路。我们把这个分歧记下来，继续往下问。',
      },
      {
        speaker: '苏怀瑾',
        intent: 'claim',
        round: 3,
        phase: 'conflict',
        content:
          '我想把讨论拉回一个前提：讨论效率提升的时候，要先问清楚谁不在场。被排除的那部分学生，收益可能正好是反向的。',
      },
      {
        speaker: '沈亦舟',
        intent: 'supplement',
        round: 4,
        phase: 'convergence',
        content:
          '这一点我接受。所以我的主张要加一个条件：AI 进入课堂必须以不扩大校际差距为前提，否则效率提升本身就不成立。',
      },
      {
        speaker: '罗青野',
        intent: 'agree',
        round: 4,
        phase: 'convergence',
        content:
          '这个前提我认同。我只补一句：一线的问题从来不是缺方法，是缺可执行的边界。',
      },
    ],
    synthesis: {
      consensus: [
        {
          statement: 'AI 进入课堂的效果高度依赖配套的教师培训与责任划分，技术本身不是瓶颈。',
          supporterNames: ['沈亦舟', '罗青野', '梁思勉'],
        },
        {
          statement: 'AI 不应在缺乏约束的情况下承担学生评价职能。',
          supporterNames: ['苏怀瑾', '罗青野'],
        },
        {
          statement: '若 AI 加剧校际资源差距，则其效率提升不构成正当性理由。',
          supporterNames: ['沈亦舟', '苏怀瑾', '罗青野'],
        },
      ],
      divergence: [
        {
          statement: 'AI 是否应当在师资与培训条件不足的学校先行试点。',
          supporterNames: ['沈亦舟', '罗青野'],
          tension: '一方认为不试点就永远拿不到真实的约束条件，另一方认为没有配套就试点只会重复设备闲置。',
        },
        {
          statement: 'AI 提升教学效率的价值，是否足以抵消它对教育公平的潜在影响。',
          supporterNames: ['梁思勉', '苏怀瑾'],
          tension: '效率口径与分配口径无法同时最优化，双方对"先回答哪个问题"存在根本分歧。',
        },
      ],
    },
    summary:
      '关于「AI 是否会取代中小学教师」，我们这一场请到了 4 位嘉宾，全部发表了意见。先说要紧的共识：大家基本站到了一起——AI 进课堂的瓶颈不在技术，而在配套的培训与责任划分；同时，让 AI 承担学生评价这件事需要非常谨慎的约束；如果它加剧了校际差距，那效率提升本身就不构成理由。仍然悬置的分歧也很清楚：一是在条件不足的学校该不该先行试点，二是效率与公平哪个应当先被回答。沈亦舟和罗青野在试点问题上没有谈拢，梁思勉和苏怀瑾则在评价口径上各执一端。如果只带走一句话：判断这件事之前，先问清楚你用的是效率的口径还是分配的口径——口径不同，结论就不会相同。感谢各位，本场讨论到此结束。',
  },
  {
    topic: '四天工作制应该被立法强制推行吗？',
    background: '已有多个国家与地区开展试点，结果差异较大',
    expertCount: 4,
    status: 'ended',
    host: HOST_SPEC,
    experts: PRESETS[4]!.suggestedPanel,
    transcript: [
      {
        speaker: '陆怀川',
        intent: 'open',
        round: 0,
        phase: 'opening',
        content:
          '欢迎来到本场圆桌。今天讨论「四天工作制应该被立法强制推行吗」。这个话题的难点在于：试点结果看起来很漂亮，但漂亮的结果是否可复制，是个真问题。',
      },
      {
        speaker: '卫知远',
        intent: 'claim',
        round: 1,
        phase: 'exploration',
        content:
          '我的判断很直接：现有试点样本严重自选择。愿意参加试点的企业本来效率就高，不能据此立法。',
      },
      {
        speaker: '谢观棋',
        intent: 'rebuttal',
        round: 1,
        phase: 'exploration',
        content:
          '卫老师说的样本问题我同意，但更现实的是：在产线场景里工时就是产能，一刀切立法只会让订单流向没有这条法律的地方。',
      },
      {
        speaker: '倪澹如',
        intent: 'rebuttal',
        round: 1,
        phase: 'exploration',
        content:
          '谢厂长的担心成立，但不立法的话，四天工作制只会变成高议价能力岗位的专属福利，差距会更大。',
      },
      {
        speaker: '何守拙',
        intent: 'supplement',
        round: 1,
        phase: 'exploration',
        content:
          '我想补一个被跳过的选项：立法不是唯一工具。先把考核方式从工时改成产出，比直接改工时更有效。',
      },
      {
        speaker: '陆怀川',
        intent: 'question',
        round: 2,
        phase: 'conflict',
        content: '倪老师，你说不立法就会变成专属福利，但这个判断成立的前提是企业的议价结构不变。如果考核方式先改了，结论还一样吗？',
      },
      {
        speaker: '倪澹如',
        intent: 'rebuttal',
        round: 2,
        phase: 'conflict',
        content:
          '考核方式改革本身就依赖议价能力，能推动改考核的岗位，本来就能自己争取到四天制。所以我还是认为需要外部约束。',
      },
      {
        speaker: '卫知远',
        intent: 'supplement',
        round: 2,
        phase: 'conflict',
        content:
          '这里有个被忽略的账：导入新制度会同时背上迁移与并行的双重成本，中小企业承担的份额远高于试点企业。',
      },
      {
        speaker: '陆怀川',
        intent: 'bridge',
        round: 3,
        phase: 'conflict',
        content: '现在分歧点已经很清楚了：一方认为立法是公平的必要条件，另一方认为立法会先伤到最没有议价能力的那部分企业。',
      },
      {
        speaker: '何守拙',
        intent: 'claim',
        round: 3,
        phase: 'convergence',
        content:
          '我提一个可落地的中间路线：先在特定行业做强制试点并公开成本数据，两年后再决定要不要普遍立法。',
      },
      {
        speaker: '谢观棋',
        intent: 'agree',
        round: 4,
        phase: 'convergence',
        content:
          '这个路线我可以接受。只要试点必须公开真实成本，制造业才有机会把话说清楚。',
      },
    ],
    synthesis: {
      consensus: [
        {
          statement: '现有四天工作制试点样本存在明显的自选择偏差，不足以直接支撑普遍立法。',
          supporterNames: ['卫知远', '谢观棋', '何守拙'],
        },
        {
          statement: '制度变更的真实成本主要由中小企业和低议价能力岗位承担。',
          supporterNames: ['谢观棋', '卫知远'],
        },
        {
          statement: '在工时之外先改革考核方式，是比直接立法更优先的选项。',
          supporterNames: ['何守拙', '卫知远'],
        },
      ],
      divergence: [
        {
          statement: '不进行强制立法，四天工作制是否会固化为高议价能力岗位的专属福利。',
          supporterNames: ['倪澹如', '何守拙'],
          tension: '一方认为外部约束是公平的前提，另一方认为考核改革可以先于立法发生。',
        },
        {
          statement: '产线等工时刚性岗位是否应当被纳入统一工时立法。',
          supporterNames: ['谢观棋', '倪澹如'],
          tension: '工时即产能的场景能否被制度覆盖，双方对"可压缩工时"的适用范围判断相反。',
        },
      ],
    },
    summary:
      '关于「四天工作制应该被立法强制推行吗」，这场讨论请到 4 位嘉宾，4 位都发了言。共识部分比较清楚：现有试点样本存在自选择偏差，不足以直接支撑普遍立法；制度变更的成本主要落在中小企业和低议价能力的岗位上；而在改工时之前先改考核方式，是更优先的动作。分歧则集中在两点：一是不立法是否会让四天制固化成少数人的福利，二是工时刚性岗位该不该被统一立法覆盖。倪澹如和何守拙在第一个问题上各执一端，谢观棋和倪澹如对"可压缩工时"的适用范围判断相反。可以带走的一个框架是：先问清楚这项制度保护的是谁、成本由谁承担——答案不同，立法与否的结论就不同。本场讨论到此结束。',
  },
];

// ------------------------------------------------------------ 物化

export function seedDatabase(repo: Repo = getRepo(), options: { force?: boolean } = {}): {
  presets: number;
  discussions: number;
} {
  repo.clearPresets();
  repo.insertPresets(PRESETS.map((preset, index) => ({ ...preset, sortOrder: index })));

  let created = 0;
  if (options.force || repo.countDiscussions() === 0) {
    for (const sample of SAMPLES) {
      materialize(repo, sample);
      created += 1;
    }
  }

  return { presets: PRESETS.length, discussions: created };
}

function materialize(repo: Repo, sample: SampleSpec): void {
  const discussion = repo.createDiscussion({
    topic: sample.topic,
    background: sample.background,
    expertCount: sample.expertCount,
    maxTurns: 24,
  });

  repo.replacePanelists(discussion.id, [
    {
      role: 'host',
      name: sample.host.name,
      title: sample.host.title,
      org: sample.host.org ?? null,
      stance: sample.host.stance,
      bio: sample.host.bio,
      color: HOST_COLOR,
      orderIndex: 0,
    },
    ...sample.experts.map((expert, index) => ({
      role: 'expert' as const,
      name: expert.name,
      title: expert.title,
      org: expert.org ?? null,
      stance: expert.stance,
      bio: expert.bio,
      color: pickColor(index),
      orderIndex: index + 1,
    })),
  ]);

  if (sample.status === 'ready') {
    repo.updateDiscussion(discussion.id, { status: 'ready' });
    return;
  }

  const panelists = repo.getPanelists(discussion.id);
  const byName = new Map(panelists.map((p) => [p.name, p.id]));

  for (const entry of sample.transcript ?? []) {
    const panelistId = byName.get(entry.speaker);
    if (!panelistId) continue;
    repo.appendTranscript(discussion.id, {
      panelistId,
      round: entry.round,
      phase: entry.phase,
      intent: entry.intent,
      content: entry.content,
    });
  }

  if (sample.synthesis) {
    repo.reconcileInsights(discussion.id, 4, sample.synthesis);
  }

  const startedAt = Date.now() - 12 * 60 * 1000;
  repo.updateDiscussion(discussion.id, {
    status: 'ended',
    phase: 'done',
    round: 4,
    summary: sample.summary ?? null,
    startedAt,
    endedAt: startedAt + 11 * 60 * 1000,
  });
}

// ------------------------------------------------------------ CLI

function run(): void {
  getDb();
  const repo = getRepo();
  const result = seedDatabase(repo, { force: process.argv.includes('--force') });
  console.log(`[seed] 预置议题 ${result.presets} 条，样例讨论 ${result.discussions} 场`);
  console.log(`[seed] 当前讨论总数：${repo.countDiscussions()}`);
  closeDb();
}

if (require.main === module) {
  run();
}
