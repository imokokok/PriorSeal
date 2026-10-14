# 决策输入证据层：买家验证名单与执行提纲

研究日期：2026-10-13，Asia/Shanghai。本文把《决策输入信任层商业分析与执行报告》的买家验证阶段落成可操作名单。公开产品资料只用于判断业务匹配，不代表任何联系、采购意向或合作承诺。

## 验证目标

从 8–10 个符合 ICP 的平台中完成问题访谈；至少两家愿意用自己的流程样本做设计验证，至少一家给出试点范围、负责人和付费可能性。公开发送、回复“有意思”、索要 demo 或同意看材料，都不计为需求验证。

访谈只确认买方现在的工作：agent 当时读到了哪些行情、token 风险、路由与授权字段；日志能否还原；谁复核；出错造成什么成本；采购和集成由谁负责。需要区分：服务收到什么、agent 实际消费什么、行动是否符合授权。这三类证据不能互相替代。

## 目标名单

| 顺序 | 团队 / 状态 | 公开匹配依据 | 首轮适配 offer | 接触目的与限制 |
|---|---|---|---|---|
| 1 | [MCPify](https://mcpify.trade/mcp/) — 新线索 | 官方页面描述通过 MCP 读取 Hyperliquid 市场与账户并下单，另有交易权限控制。 | 先验证 Insight 单售；若其审阅流程要求把市场评估、用户授权和执行串起来，再讨论组合方案。 | 直接问最近一次输入争议、行情/路由快照保留方式、拒绝交易规则由谁审核。用户公开页面不能证明有预算。 |
| 2 | [Warden402 #2](https://github.com/sukrutkrdg/warden402.xyz/issues/2) — 已触达 | 公开议题讨论可组合的 market-state 信号。 | Insight 单售优先；只有存在明确授权和执行证据缺口时再看组合。 | 2026-10-12 的公开发帖已有记录；当前无回复。按原计划不提前追问，最早 2026-10-26 再评估一次跟进。不能把发帖算作需求。 |
| 3 | [AgentWallet-MCP #18](https://github.com/hifriendbot/agentwallet-mcp/issues/18) — 已触达 | 公开议题讨论 router 调用缺少 market-state 保护。 | Insight 单售优先；必要时再看组合方案。 | 2026-10-12 的公开发帖已有记录；当前无回复。最早 2026-10-26 再评估一次跟进。不能把发帖算作需求。 |
| 4 | [Crossmint](https://www.crossmint.com/solutions/agentic-payments) — 新线索 | 官方产品面向 agent 钱包、支付和可配置 guardrails。 | Insight 单售或集成能力评估；PriorSeal 的授权/执行层可能与现有钱包控制重叠，先问具体缺口。 | 作为钱包基础设施产品团队验证者或渠道；不要把钱包 guardrails 的存在当成购买证据。 |
| 5 | [Coinbase CDP Agentic Wallets](https://www.coinbase.com/developer-platform/products/agentic-wallets) — 新线索 | 官方产品支持 agent 支出、交易与 session / transaction guardrails。 | Insight 单售优先。 | 验证外部输入质量证据是否在其产品流程中造成实际问题；大平台且已有防护，采购概率未知。 |
| 6 | [Privy Agent Wallets](https://www.privy.io/agent-wallets) — 新线索 | 官方页面覆盖 agent 钱包、策略、审批和交易活动。 | Insight 单售；PriorSeal 仅在客户明确需要独立授权/执行证据时进入。 | 作为集成伙伴或产品团队访谈；不把策略引擎与签名快照说成同一能力。 |
| 7 | [thirdweb Engine session keys](https://portal.thirdweb.com/engine/v3/guides/session-keys) — 新线索 | 官方文档支持 session key 代账户执行交易。 | Insight 单售优先；组合能力为条件选项。 | 验证它们的 agent 客户是否需要可复核的交易前输入；先找开发者/产品负责人。 |
| 8 | [Biconomy Smart Accounts](https://account-abstraction-docs.biconomy.io/smartAccountsV2/account/) — 新线索 | 官方文档描述 ERC-4337 账户及 session-key 等验证模块。 | Insight 单售；PriorSeal 价值取决于其账户策略之外是否还需可携带的审阅记录。 | 作为账户抽象基础设施团队或渠道验证者；不是默认的组合客户。 |
| 9 | [ATXP](https://atxp.ai/brand-facts/) — 新线索 | 官方资料定位为 agent 身份、支付和按次调用基础设施。 | 仅当受访者确认 agent 会做链上金融动作时测试 Insight；否则从 ICP 排除。 | 用于辨别“agent 支付”是否真的对应高风险、不可逆交易，而不是把 x402 使用量当收入信号。 |

其中 1、4–9 是候选访谈线索；2、3 是已公开触达的线索。名单基于公开业务匹配排序，不代表已联系或愿意采购。先从 1、4、6 开始：前者直接执行 Hyperliquid 交易，后两者掌握 agent 钱包产品流程；其余用作补足样本和反证。

## 单次访谈记录模板

每次只收集对方愿意披露的信息；不要求客户账本、钱包密钥、未公开事件细节或未经脱敏的交易数据。

1. 最近一次输入争议或 agent 错误动作是什么？发生在哪个具体流程，增加了多少调查或复核时间？
2. 当时日志保存了哪些字段？能区分 API 收到、agent 读取、agent 决策和实际链上执行吗？谁能修改或删除记录？
3. 外部审阅者现在能独立确认什么？最重要的缺口是来源响应、agent 消费、用户授权还是执行结果？
4. 现有钱包、策略引擎、模拟和审计工具为什么没解决？是否存在共享上游数据或同一信任根？
5. 哪个团队会集成和验收？谁有预算权，预算来自哪项现有成本？最低可接受的试点范围和成功指标是什么？
6. 三个 offer 中哪个贴合实际工作：Insight、PriorSeal，还是 Insight + PriorSeal？若现有钱包已覆盖授权控制，明确记录组合方案的边际价值为未知或没有。

每条记录标注 `LEAD`、`REACHED`、`INTERVIEWED`、`DESIGN_VALIDATION` 或 `NO_SIGNAL`，另列事实、对方原话摘要、来源、下一步、负责人和日期。只有对方举出真实案例并确认当前成本、验收人或试点负责人，才能从 `INTERVIEWED` 进入设计验证。

## 首轮邀约草稿（尚未发送）

> Hi — I’m validating a small decision-input evidence feature for agent platforms that execute financial actions. It signs the exact normalized view returned alongside a source-response digest and supports offline verification against a separately trusted key registry. It does not claim that a source is correct or that an agent consumed the data. Would you be open to a 15-minute workflow interview about how your team reconstructs the inputs behind an executed or rejected transaction? I’m looking to understand your current process, not to assume a product fit. If useful, I can share a synthetic offline-verifiable sample first.

针对钱包基础设施公司，把问题改为“他们的客户是否因交易前决策输入而产生重复的支持/审计成本”；针对直接执行平台，改为“最近一次真实事件与恢复过程”。不以 AIUC-1、保险、x402 交易额或“防止损失”作未经证实的销售承诺。

## 状态与退出门槛

- 截至 2026-10-13，没有完成访谈、设计伙伴确认或付费试点信号；以上均为线索。
- 截至 2026-10-13，新列的 7 家还没有收到邀约。当前 Gmail connector 被管理员禁用，也没有可代表用户身份发送的私密邮箱通道；这里保留了首轮草稿，没有把买家访谈邀请发成对方仓库里的无关公开 issue。
- 8–10 次合格访谈后仍找不到具体案例、预算负责人和集成需求，就收窄为 Insight 的基础证据能力，不继续扩展 cross-check、validator 或保险专用包。
- 只有两家买家愿意提供流程样本后，才评估字段 cross-check；只有一家设计伙伴确认需求并同意试点后，才做通用 Insight × PriorSeal Evidence Bundle。
