# AI Panel Studio · AI 圆桌讨论演播厅

输入一个待讨论的议题与参会专家人数，系统调用大模型**动态生成主持人 + 专家阵容**（姓名 / 职业 / Title / 立场 / 专属身份色）。
用户确认阵容后进入演播厅，观看一场由 AI 驱动、实时推进的圆桌讨论：主持人负责开场、追问、串联与收尾，专家根据当前 transcript **自主决定发言顺序**（抢答 / 反驳 / 补充 / 附和），讨论过程中持续生成共识与分歧。

> 本仓库是从 0 到 1 完成的工程化实现：先锁定契约与数据模型，再按「数据层 → 引擎层 → 接口层 → 测试层 → 界面层」逐层落地，
> 每个阶段都有可验证的产出。完整的分阶段 Prompt 记录见 [docs/PROMPTS.md](docs/PROMPTS.md)，开发过程与工作流说明见 [docs/WORKFLOW.md](docs/WORKFLOW.md)。

---

## 1. 快速开始

环境要求：**Node.js ≥ 20**（开发与验证使用 Node 22）、npm 10+。无需数据库服务，SQLite 是本地文件。

```bash
# 1) 安装依赖（npm workspaces，一次装齐 server + web）
npm install

# 2) 重建数据库并灌入样例数据（6 条预置议题 + 3 场样例讨论）
npm run db:reset

# 3) 同时启动后端与前端
npm run dev
```

打开 <http://localhost:5173> 即可使用。

**零配置可运行**：未配置 `LLM_API_KEY` 时，后端自动降级到内置的**离线确定性模拟引擎**，讨论依然能完整跑完（页头会标注「离线模拟引擎」）。
想接入真实模型，把 `.env.example` 复制为 `.env` 并填入密钥即可：

```bash
cp .env.example .env
# 编辑 .env，填写 LLM_API_KEY=sk-xxxx
```

### 其它脚本

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 并行启动后端（8787）与前端（5173） |
| `npm run build` | 后端 `tsc` 编译 + 前端 `vite build` |
| `npm start` | 以编译产物启动后端（生产模式） |
| `npm test` | 运行后端全部测试（62 项：单元 + 端到端） |
| `npm run db:seed` | 仅灌入样例数据（幂等） |
| `npm run db:reset` | 删除 SQLite 文件并重建 + 灌入样例数据 |

---

## 2. 环境变量

所有变量只在**后端进程**读取（`server/src/config.ts` 统一收敛）。前端代码与构建产物里不存在任何密钥，浏览器也无法请求到它。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | 后端监听端口 |
| `DB_PATH` | `./data/panel.db` | SQLite 文件路径（相对 `server/`） |
| `CORS_ORIGIN` | `http://localhost:5173` | 允许跨域的前端地址 |
| `LLM_PROVIDER` | `deepseek` | `deepseek` / `openai` / `custom`，仅用于日志与 `/api/health` 展示 |
| `LLM_API_KEY` | 空 | **大模型密钥，只放这里**。为空时自动切换模拟引擎 |
| `LLM_BASE_URL` | `https://api.deepseek.com/v1` | OpenAI 兼容的 Chat Completions 端点 |
| `LLM_MODEL` | `deepseek-chat` | 模型名 |
| `LLM_TEMPERATURE` | `0.9` | 圆桌讨论需要观点发散，略高于常规问答 |
| `LLM_TIMEOUT_MS` | `60000` | 单次请求超时 |
| `LLM_MOCK` | `false` | 强制使用离线模拟引擎（测试环境恒为 `true`） |
| `TURN_INTERVAL_MS` | `900` | 发言之间的停顿，用于营造实时节奏 |
| `MAX_TURNS` | `24` | 单场讨论的发言上限，防止无限循环烧 token |

---

## 3. 技术选型说明

| 层 | 选型 | 为什么 |
| --- | --- | --- |
| 仓库结构 | **npm workspaces monorepo**（`server/` + `web/`） | 前后端分离但共享一套安装与脚本；契约文档与两端代码在同一处演进 |
| 后端 | **Node.js 22 + TypeScript + Express 4**（CommonJS） | 讨论引擎是长驻异步流程 + SSE 长连接，Node 的异步模型天然契合；Express 足够薄，不引入多余抽象 |
| 数据库 | **better-sqlite3**（同步 API） | 单机应用不需要连接池与网络往返；同步 API 让「事务内同 seq 写 transcript + event」这类一致性要求写起来毫无竞态 |
| 校验 | **zod** | 请求边界校验与错误信息结构化，路由层只做「校验 + 状态机检查 + 调用服务」 |
| 实时推送 | **SSE**（`text/event-stream`） | 讨论是**单向**推送（服务端 → 浏览器），SSE 比 WebSocket 少一层握手与心跳协议，且原生支持 `Last-Event-ID` 断线续传 |
| 大模型接入 | **OpenAI 兼容协议** + `LlmEngine` 接口 | 换模型只改环境变量；接口化后可以用确定性的模拟引擎跑测试 |
| 前端 | **React 18 + TypeScript + Vite 6** | 三页应用不需要路由库与状态库：hash 路由 + `useReducer` 级别的本地状态足够，依赖越少越不容易在交付时出问题 |
| 测试 | **Vitest 2 + supertest** | 与 Vite 同源的工具链；端到端测试直接打真实 HTTP，不 mock 引擎（用模拟引擎替代模型） |

### 大模型调用策略

- **密钥不出后端**：`LLM_API_KEY` 只在 `server/src/config.ts` 被读取，`/api/health` 只暴露 `provider / model / mock`，错误信息只回显状态码与截断后的响应正文。
- **输出容错**：真实模型即使被要求「只输出 JSON」也可能包上 ```json 围栏或加一句寒暄，`server/src/llm/json.ts` 负责剥离噪声、强转字段，解析失败返回兜底值而不是让整场讨论崩掉。
- **硬约束在服务端兜底**：「每次发言 1–2 句」不只是 prompt 里的要求，`cleanUtterance()` 会在落库前再切一次句并截断。
- **上下文裁剪**：只把最近 8 轮发言喂给发言生成、最近 20 轮喂给共识提炼，避免 token 无限增长与长上下文幻觉。

---

## 4. 项目结构

```
AI Panel Studio/
├── docs/
│   ├── PRD.md          # 产品需求（角色、流程、验收口径）
│   ├── ER.md           # ER 图（mermaid）
│   ├── API.md          # REST + SSE 契约、时序图、状态机
│   ├── PROMPTS.md      # 核心 Prompt 记录（SDD / DDD / TDD / E2E 四阶段）
│   └── WORKFLOW.md     # 开发过程思路与工作流说明
├── server/
│   ├── src/
│   │   ├── config.ts           # 环境变量收敛（唯一读取密钥的地方）
│   │   ├── domain/types.ts     # 领域模型 + LLM 契约
│   │   ├── db/
│   │   │   ├── schema.sql      # 6 张表的建表脚本
│   │   │   ├── index.ts        # 连接 / 内存库 / 建表
│   │   │   ├── mappers.ts      # 数据库行(snake_case) → 领域对象(camelCase)
│   │   │   ├── repo.ts         # 唯一的 SQL 出口
│   │   │   ├── seed.ts         # 6 条预置议题 + 3 场物化样例讨论
│   │   │   └── reset.ts        # 删库重建
│   │   ├── llm/
│   │   │   ├── types.ts        # LlmEngine 接口（6 个方法）
│   │   │   ├── prompts.ts      # 5 组提示词与硬性约束
│   │   │   ├── json.ts         # 模型输出的容错解析与清洗
│   │   │   ├── openai.ts       # OpenAI 兼容实现（含超时与错误脱敏）
│   │   │   ├── mock.ts         # 离线确定性引擎（6 个立场原型 + 共识/分歧池）
│   │   │   └── index.ts        # 引擎选择
│   │   ├── engine/
│   │   │   ├── eventBus.ts     # 按 discussionId 分区的事件总线
│   │   │   ├── context.ts      # 上下文裁剪
│   │   │   ├── plan.ts         # 发言顺序决策（意图权重 + urgency）
│   │   │   └── orchestrator.ts # DiscussionRuntime：一场讨论一个实例
│   │   ├── services/panelService.ts  # 阵容生成（服务端分配身份色）
│   │   ├── routes/{index,stream}.ts  # REST + SSE
│   │   └── index.ts            # createApp() / main()
│   └── tests/
│       ├── unit/               # plan / json / repo / context / mockEngine
│       └── e2e/api.test.ts     # 13 项端到端用例
└── web/
    └── src/
        ├── styles/             # tokens / base / pages / studio（设计系统）
        ├── api/                # 契约类型 + REST 客户端
        ├── hooks/              # useHashRoute / useDiscussionStream(SSE)
        ├── components/         # 9 个展示组件
        └── pages/              # HomePage / SetupPage / StudioPage
```

---

## 5. 主要 API

完整契约（含字段定义、时序图、状态机）见 [docs/API.md](docs/API.md)。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查，暴露 `provider / model / mock`，**不含密钥** |
| `GET` | `/api/preset-topics` | 预置议题库（6 条样例，含建议嘉宾阵容） |
| `GET` | `/api/discussions?status=&limit=` | 首页讨论列表（含 `palette` 配色与统计） |
| `POST` | `/api/discussions` | 创建讨论草稿（`topic` 2–200 字，`expertCount` 2–6） |
| `GET` | `/api/discussions/:id` | 讨论详情（`panelists` / `transcript` / `insights` / `lastSeq`） |
| `GET` | `/api/discussions/:id/transcript?since=` | 增量拉取发言（配合 `lastSeq` 做断线续传） |
| `POST` | `/api/discussions/:id/panel` | 生成 / 重新生成阵容（1 主持人 + N 专家） |
| `PATCH` | `/api/discussions/:id/panel/:panelistId` | 确认前微调单个嘉宾（姓名 / Title / 立场 / 颜色） |
| `POST` | `/api/discussions/:id/start` | 启动讨论引擎（异步），返回 `live` |
| `POST` | `/api/discussions/:id/pause` \| `/resume` \| `/stop` | 暂停 / 继续 / 结束（`stop` 返回时总结已生成） |
| `DELETE` | `/api/discussions/:id` | 删除讨论 |
| `GET` | `/api/discussions/:id/stream?since=` | **SSE**：先 `snapshot`，再按 `seq` 增量推送 |

### SSE 事件

`snapshot` · `discussion.status` · `panelist.status` · `transcript.append` · `insight.upsert` · `summary.final` · `error` · `heartbeat`

- 每条事件都带全局单调递增的 `seq`，同时作为 SSE 的 `id` 字段，浏览器重连时自动带上 `Last-Event-ID` 实现续传。
- `panelist.status` 里的 `focus` 是**对外可见的关注点摘要**，不是模型隐藏的推理链。
- `transcript.append` **不会**推送「举手 / 抢答」这类内部调度事件——它们只影响发言顺序，不进事件流，也不上页面。

---

## 6. 核心设计取舍

**多讨论并行隔离。** 每场讨论一个 `DiscussionRuntime` 实例，`EventBus` 按 `discussionId` 分区；订阅者只收到自己那场的事件，一场讨论的引擎异常不会影响另一个 SSE 连接。状态、事件流、transcript、共识分歧因此天然隔离，而不是靠前端过滤。

**统一 seq 解决两个一致性问题。** transcript 条目与事件共享同一张 `discussion_event` 表的 `seq`，于是「中途加入」与「断线重连」用同一个游标：SSE 先推 `snapshot`（完整状态），再回放 `seq > since` 的历史事件，最后转入实时。服务端**先订阅再回放**并按 `seq` 去重，消除订阅与回放之间的竞态。

**禁止机械式轮流发言。** 每轮先让所有专家并行给出「是否想发言 + 意图（claim/rebuttal/supplement/agree）+ 抢答优先级」，再由 `plan.ts` 排序：`rebuttal(4) > supplement(3) > claim(2) > agree(1)`，同优先级按 `urgency` 降序，同轮去重。首轮额外保证全员表态，避免有人整场沉默。发言顺序是**决策结果**，因此不出现在页面上。

**共识与分歧实时增量。** 每轮结束都从增量 transcript 重新提炼一次，`reconcileInsights()` 按归一化后的 statement 对账：已存在的条目合并支持者、`emerging → stable`，新条目插入。不是等讨论结束才生成一份报告。

**颜色即身份。** 颜色由**服务端**分配（`server/src/util/palette.ts`），并在状态灯、发言色块、共识/分歧标签三处复用同一个 hex，用户靠颜色而非读名字追踪谁在说话。

**零配置可演示。** `LlmEngine` 接口有两个实现：`OpenAiEngine` 与 `MockEngine`。后者是确定性规则引擎（mulberry32 PRNG + 6 个立场原型 + 共识/分歧组合池），未配置密钥时自动启用。这让交付物**开箱即跑、可测试**，也让测试不必 mock 网络。

---

## 7. 测试

```bash
npm test
```

```
✓ tests/unit/context.test.ts   (6)   上下文裁剪
✓ tests/unit/plan.test.ts      (8)   发言顺序决策
✓ tests/unit/json.test.ts     (11)   模型输出容错与 1–2 句清洗
✓ tests/unit/mockEngine.test.ts (13) 离线引擎的阵容 / 发言 / 共识提炼
✓ tests/unit/repo.test.ts     (11)   数据层：事务、seq、共识对账
✓ tests/e2e/api.test.ts       (13)   端到端：主链路 / 状态机 / 并行隔离 / SSE
Tests  62 passed (62)
```

端到端用例**不 mock 引擎**，而是通过 `vitest.config.ts` 注入 `LLM_MOCK=true` / `TURN_INTERVAL_MS=0`，跑的是与生产同一套编排代码，只是把模型换成了离线实现。覆盖的关键断言包括：

- 讨论开始后不允许再修改阵容（409）
- 每次发言 ≤ 2 句、≤ 200 字（主持人收尾总结按设计是整段，单独排除）
- transcript 首条是 `open`、末条是 `summary`，且不出现「举手 / 抢答」
- 总结是自然语言，不含 `{` 与 ``` 围栏
- 两场并行讨论的嘉宾 id 集合完全不相交，发言与共识各自带正确的 `discussionId`
- SSE 首帧是 `snapshot`，`seq` 单调不减，六类事件齐全

---

## 8. 已完成能力

- [x] 首页讨论列表（按状态筛选、配色预览、发言/共识/分歧计数、5 秒轮询刷新）
- [x] 议题发起：议题 + 背景 + 专家人数（2–6），预置议题一键带入
- [x] 动态生成主持人 + 专家阵容，含姓名 / 职业 / Title / 立场 / 简介 / 身份色
- [x] 确认前逐位微调（姓名 / Title / 立场 / 身份色），阵容锁定后拒绝修改
- [x] 演播厅：主持人开场 / 追问 / 串联 / 总结，专家自主抢答 / 反驳 / 补充 / 附和
- [x] 专家状态小窗：待机 / 准备发言 / 整理思路 / 发言中 + 公开关注点摘要（**不展示隐藏 CoT**）
- [x] 实时共识与分歧板：随轮次持续 upsert，`emerging → stable`
- [x] 现场 Transcript：姓名 + 职业/Title + 与嘉宾一致的身份色，**不含内部调度事件**
- [x] 主持人自然语言总结，页面上不出现 JSON 原文
- [x] 暂停 / 继续 / 结束 / 删除，完整状态机 `draft → ready → live ⇄ paused → ended`
- [x] 多讨论并行，状态 / 事件流 / transcript / 共识分歧互相隔离
- [x] SSE 实时推送，`seq` 游标 + `Last-Event-ID` 断线续传
- [x] 三栏微响应式布局：**整页不滚动**，超宽屏三栏并列、常规桌面收成两栏、窄屏单栏 + 区域切换，每个区域独立滚动
- [x] `prefers-reduced-motion` 降级、入场动画 fail-open、键盘可达与语义化标签
- [x] 62 项测试全绿；未配置 API Key 时离线可完整演示

## 9. 后续改进方向

- **讨论可回溯**：目前只有「当前状态」，可以引入发言快照（每 N 轮存档）以支持时间轴拖拽回看。
- **共识提炼的稳定性**：现在靠 statement 归一化字符串对账，措辞变化会产生近似重复条目；可换成向量聚类或让模型输出稳定的 `insight_key`。
- **发言顺序的可解释性**：`plan.ts` 的意图权重目前是固定常数，可以引入「上一轮是否被反驳 / 是否被主持人点名」等动态因子，并给主持人增加显式的「点名追问」能力。
- **成本与并发**：所有讨论共享一个进程内引擎，规模化需要把 `DiscussionRuntime` 拆到独立 worker，并给 LLM 调用加令牌桶与预算上限。
- **数据层**：`better-sqlite3` 同步写足够单机使用，若要支持多实例部署需要换成 Postgres 并把 `EventBus` 替换为 Redis Pub/Sub。
- **前端**：列表页目前用 5 秒轮询，可以复用同一条 SSE 通道做全站推送；嘉宾色板可支持自定义 hex 而不只是 8 色候选。
