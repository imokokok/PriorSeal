# Insight 与 PriorSeal 独立商业方向的买方需求研究

研究日期：2026-10-03，Asia/Shanghai。研究对象：两个项目分别销售、分别交付的非 AI agent 业务。本文是商业研究，不改变产品定位、代码、部署或既有合作承诺。

## 一 结论与投入顺序

**本次发现最值得用真实订单验证的方向，是为加密资产会计服务商和财务团队提供 DeFi 交易数据解析、异常修复与复核材料。它更接近 Insight 的数据与协议适配能力，但仍需新建财务数据流程，当前产品不能直接作为完整解决方案出售。**

这个判断来自三个不同层次的证据：市场有公开收费的复杂数据处理服务；现有软件承认仍有人工复核工作；Insight 已有部分链上取数、协议读取和执行事件解析基础。三者共同支持一个可检验的商业假设，尚不能证明会计服务商愿意把工作外包给 Insight。

**PriorSeal 当前未通过独立第二赛道的采购验证。** 钱包审批和执行控制有具名使用案例，但这些采购同时包含密钥管理、强制策略、模拟和服务支持。现有材料不足以证明买方会额外购买独立的授权执行证据产品。建议保留当前技术定位，只有出现明确预算与外部审阅要求时才做客户适配。

如果要求完全不增加新的业务能力、只靠当前已交付产品进入一个确定有独立购买需求的新市场，本次没有找到符合条件的方向。这一限制对两个项目都成立。

### 本次建议

| 项目 | 建议 | 现在可以做的商业动作 | 不足以启动开发的信号 |
|---|---|---|---|
| Insight | 优先验证 DeFi 财务数据异常修复，先按案件交付 | 获取客户现有软件无法处理的一小批真实交易，确认交付标准和预算 | 只有对技术感兴趣、想免费试用或愿意看一个通用演示 |
| PriorSeal | 暂不宣布新的独立赛道 | 验证外部审阅者具体缺少哪项授权或执行材料，以及采购负责人 | 对签名、时间戳或开放验证器的技术认可 |

用户已排除的预言机选型与接入评估不再作为候选。十五分钟采集下的实时预言机防护也不纳入推荐。

## 二 研究方法与证据边界

筛选顺序是：买方正在采购的结果 → 实际工作与现有方案 → 尚需人工处理的问题 → 自有交付能力 → 成本与获客条件。

本次使用四组行业研究材料、公开定价、具名客户案例、官方产品说明与当前源码。来源目录列明阅读范围。没有把融资额、代币市值、TVL 或支付流水当作软件采购预算；没有访问供应商合同、银行流水或客户采购系统。

| 证据类型 | 本文怎样使用 | 不能推出什么 |
|---|---|---|
| 公开服务价格 | 证明有明确收费供给，提供价格参照 | 不证明已成交数量、实际折扣或你的可售价格 |
| 具名客户采用案例 | 证明供应商公开报告了具体使用场景 | 未经买方独立确认，不当作审计过的效果或合同金额 |
| 官方帮助文档和限制 | 判断实际工作、产品覆盖及残留问题 | 不把某个困难推成整个行业都无法处理 |
| 行业调查和研究报告 | 判断需求结构、样本与采用方向 | 投资意愿、使用兴趣和流水不等于采购你的产品 |
| 本地源码与范围文档 | 判断已有模块与明显缺口 | 代码存在不等于线上可用、审计通过或客户接受 |
| 本文建议 | 决定验证顺序和停止条件 | 不冒充市场事实或客户承诺 |

本次是桌面研究与局部代码核对，没有重新执行生产负载测试、功能验收或安全审计。代码基线为 Insight `07a6289e5a85b73196b69d02ac49514ba53b69ba`、PriorSeal `ff5d260adeb55292df830bde755899261aac5bb0`；两个主工作区在研究读取时没有未提交修改。未发布的实验分支不算已交付能力。

## 三 研究报告告诉我们的需求结构

### 真实支付量需要与链上总流水区分

McKinsey 与 Artemis 于 2026-02-18 发布的分析，把实际支付与交易、内部划转和自动化活动区分。文中约 3900 亿美元的支付规模，脚注注明依据 2025 年 12 月活动年化；B2B 部分约 2260 亿美元。这里采用该年化口径，不能把它写成独立核验的全年累计结算额，更不能视为对账软件市场收入。[研究正文](https://www.mckinsey.com/industries/financial-services/our-insights/stablecoins-in-payments-what-the-raw-transaction-numbers-miss)

Artemis 在 2025-05-29 的研究发布说明中，称与 20 家稳定币企业合作；其样本中 USDT 和 TRON 占据重要位置。这个历史样本提示：PriorSeal 的 EVM 覆盖不能自动代表覆盖整个稳定币支付市场。该样本也不用于推断今天所有支付公司的链分布。[研究发布说明](https://research.artemis.ai/p/what-are-stablecoins-used-for)

### 机构更愿意把数字资产纳入已有流程

EY-Parthenon 与 Coinbase 的 2026 年调查公开摘要中，53% 的受访者偏好具备加密资产能力的传统金融平台，68% 偏好与加密原生企业合作补足能力。这是特定机构样本的意愿调查。本文据此提出的推论是：能接入现有数据和财务流程的小模块值得验证；要求客户新增一个孤立工作台，需要更强理由。[调查摘要](https://www.ey.com/en_us/financial-services/institutional-digital-assets-survey)

McKinsey 2026-09-25《Global Payments Report》的公开节选讨论了运营效率与多支付渠道连接的成本压力。它有助于解释为什么运营自动化值得采购，但不能证明独立签名收据有单独预算。[报告公开节选](https://www.mckinsey.com/industries/financial-services/our-insights/global-payments-report)

**四组材料共同帮助定位业务流程；真正筛选机会仍要依赖下面的具体产品、客户和人工服务证据。**

## 四 已有采购和收费供给在哪里

| 买方要完成的工作 | 公开证据 | 预算或采购负责人 | 对你的含义 |
|---|---|---|---|
| 整理复杂加密交易，完成报税前的数据修复 | CoinTracking Full Service 的 Advanced 公开起价为 2799 美元或 2499 欧元，包含复杂资产处理与税务报告 | 复杂投资组合持有人、受委托的会计服务商 | 数据错误会引发付费人工处理；整包价格包含税务专业工作，不能直接套给你的技术交付 |
| 管理多个客户的加密资产记录 | CoinTracking Corporate 公布每年 1799 美元或 1599 欧元，含三个 Unlimited 账户 | 会计事务所合伙人、服务线负责人 | 会计服务商确实面对软件费用；简单多账户功能已有成熟竞争 |
| 付款审批、自动对账、会计系统同步 | Request Finance 页面显示 Growth 为每月 300 美元，含相关能力；另有套餐和交易费用 | 财务负责人、财务运营负责人 | 市场有明确收费供给，但完整流程已被集成，单一收据或导出功能价值有限 |
| 链上链下账户对账与企业财务记录 | Cryptio 公布 Circle、Transak、Securitize 的具名反馈 | 财务负责人、财务控制团队 | 买方购买数据完整性、系统连接和差异处理；完整企业方案超出当前项目 |
| 银行客户账户与机构账目对应 | Bitwave 的 FV Bank 案例描述机构层与客户层的双层记录 | 银行财务与运营团队 | 需求真实，但属于更重的企业系统集成，首单难度高 |
| 财务软件取得估值数据 | Kaiko 的 Recap 案例描述为税务会计软件提供公允价值价格服务 | 数据产品负责人、财务软件负责人 | 独立数据产品存在买方；历史覆盖、方法、许可和接受度是主要门槛 |
| 委托管理资金时控制谁能做什么 | Fordefi 的 Midas 案例描述发行人、管理人和独立监督方的三方审批 | 财库运营、安全或资产管理负责人 | 授权需求真实，但客户同时购买签名前控制、模拟、钱包和运营支持 |

价格与案例在 2026-10-03 读取，供应商可能更新。以上没有任何一家被认定为你的客户或已有采购意向。

来源：[CoinTracking 人工服务](https://cointracking.info/crypto-tax-full-service/)、[Corporate 定价](https://cointracking.info/corporate-pricing/)、[Request Finance 定价](https://www.requestfinance.com/pricing)、[Cryptio 对账及客户反馈](https://www.cryptio.co/solutions/reconciliation)、[FV Bank 案例](https://www.bitwave.io/blog/fv-bank-case-study-challenge-bitwaves-solution-and-outcome)、[Recap 案例](https://www.kaiko.com/resources/recap-client-story)、[Midas 案例](https://www.fordefi.com/customer-stories/how-midas-brings-tokenized-investment-opportunities-on-chain-with-fordefis-defi-native-custody-2ti85)。

## 五 逐个筛掉不适合当前投入的方向

下面的“缺口”是本次能力核对与商业推断，不是对供应商安全性或经营状况的评级。

| 候选业务 | 需求证据 | Insight 当前能力距离 | PriorSeal 当前能力距离 | 决定 |
|---|---|---|---|---|
| 完整加密财务与税务软件 | 明确收费供给和客户案例 | 缺完整账本、税务口径、广泛历史连接 | 授权证据不能代替账本和会计模型 | 排除全面竞争 |
| 通用稳定币付款与对账平台 | 明确收费套餐 | 价格模块只覆盖很小部分 | 有交易观察基础，缺票据、付款匹配、银行和ERP流程 | 排除通用平台；不能只靠收据切入 |
| 机构行情与估值基准 | 具名数据使用案例 | 缺足够历史行情、市场覆盖、许可与机构交付体系 | 与核心能力关系较远 | 暂不投入 |
| 最佳执行和交易成本分析 | Wyden 与 Kaiko 公布相关数据集成 | 缺执行时刻的市场基准、深度与机会成本模型 | 调用匹配不能评价成交质量 | 排除当前直接销售 |
| 企业钱包审批及控制 | 具名三方治理案例和成熟产品 | 关系较远 | 有授权模型，但核心服务不掌握签名和执行控制 | 排除建设完整钱包控制平台 |
| 独立授权执行证据 API | 钱包供应商已提供相近能力，额外采购证据不足 | 关系较远 | 技术最近，独立购买理由弱 | 只接受明确客户需求驱动 |
| RWA 估值及资产运营 | 企业对账案例包含代币生命周期 | 缺底层资产、发行人和基金管理记录 | 有限调用证据不能确认底层资产事实 | 暂不投入 |
| DeFi 财务数据异常修复 | 人工服务收费、软件承认人工复核、专业事务所提供服务 | 可复用部分模块，需补交易语义及交付流程 | 可复用观察模块，授权核心价值不突出 | 优先验证 Insight 的小范围服务 |

机构交易数据的门槛可以由 [Wyden 与 Kaiko 的集成说明](https://www.kaiko.com/news/wyden-and-kaiko-partner-to-deliver-institutional-market-data-for-benchmarking-performance-tracking-and-mica-compliance) 和 [CME 的 Kaiko 数据使用案例](https://www.cmegroup.com/articles/case-study/case-study-optimizing-access-to-cme-group-cryptocurrency-data-via-websocket-api.html)看出：客户需要交易、历史与分发基础设施。数据采购本身有成本；可免费访问部分预言机接口不等于已获得完整可销售数据集。

本次没有验证出付费软件市场中“竞争很少、直接复用现有功能就可成交”的空白。选择有竞争的领域，需要找已经发生、持续花费人工的剩余工作。

## 六 Insight 最值得验证的具体业务

### 业务定义

**给已有会计软件的团队，把处理不好的 DeFi 交易还原成可复查、可导入的财务数据。**

第一批客户候选是加密资产会计事务所或财务外包团队中的对账负责人。最终会计和税务判断由客户专业人员负责；Insight 交付链上事实、解析规则、差异解释和导入数据。

这会把 Insight 扩展到新的数据工作流。应明确承认这是一项有一定改造量的商业实验，不能只修改首页文案就称为已经支持。

### 为什么这个剩余问题有依据

Koinly 在自己的产品比较文章中承认，复杂 L2 转账、流动性质押、跨链桥和实验性协议等活动仍可能需要人工复核。它同时已支持大量 DeFi 类型，所以不能把普通 swap、存借款识别当作默认空白。[官方说明](https://koinly.io/compare/cryptotaxcalculator-vs-koinly/)

Koinly 的 Aurum FSG 服务商页面明确列出缺失成本基础、误分类 DeFi、重复导入和历史重建等人工服务。Chainwise CPA 的页面也列出逐钱包对账与复杂协议处理。这说明残留工作被专业团队承接；是否外包技术子任务，仍须向这些团队验证。[Aurum FSG](https://koinly.io/accountants/aurumfsg/)、[Chainwise CPA](https://koinly.io/accountants/chainwise-cpa/)

### 第一个可交付订单长什么样

建议的验收单位是一批已知异常，而不是一个完整钱包的所有历史。

输入：客户现有软件的导出、具体异常说明、目标钱包、链和交易哈希清单，以及客户认可的解释口径。

输出：

1. 原始交易、回执、日志及区块定位。
2. 每个代币的合约地址、原始整数金额、精度和收付方向。
3. 在支持范围内，对存入、赎回、借还款或兑换的业务动作解释。
4. 与原导入记录的差异及修正依据，保留旧值和新值。
5. 能导入客户现有工具的文件，附仍无法确认的条目。

具体选择哪一种协议或交易路径，由买方提供的异常决定。先证明其现有软件及正常支持渠道确实没有解决这个问题，再讨论付费实现。

### 已有能力和必须新建的能力

| 交付环节 | 已有依据 | 真实缺口 |
|---|---|---|
| 取得已知交易的回执和时间 | `executionCollector.ts` 已实现指定交易采集 | 不等于完整钱包历史索引；原生币内部转账可能需要 trace |
| 解析 ERC20 资金流 | `events.ts` 解码 Transfer，保留原始 bigint | Transfer 不能单独确认存款、赎回、奖励或税务分类 |
| 理解部分借贷协议状态 | Aave、Compound、Morpho 等 importer | 当前状态读取不能代替历史逐笔事件解析 |
| 解释价格依据 | 多来源比较与时间信息 | 十五分钟价格不能充当精确历史成交价；正式估值另需认可来源和使用许可 |
| 保存可复查材料 | 现有证据与 verifier 工程 | 需财务修订记录、审阅流程、客户导入格式 |
| 精确金额处理 | 底层已有整数事件金额 | 现有部分执行展示字段使用 number，不能原样当作财务账本金额 |

代码来源：[事件解析](/Users/imokokok/Documents/insight/src/lib/execution/events.ts)、[执行采集](/Users/imokokok/Documents/insight/src/lib/execution/executionCollector.ts)、[Aave 读取](/Users/imokokok/Documents/insight/src/lib/protocols/importer/aaveV3Importer.ts)、[执行证据服务](/Users/imokokok/Documents/insight/src/lib/execution/executionReceiptService.ts)。

需新建的核心包括：限定协议的历史事件规则、逐笔对应与去重、精确整数或十进制模型、修订与人工批准记录、现有会计工具的导入适配。现有原生币缺失、部分成交不能识别等情况必须继续显式报告，不能为了让账目匹配而推造数据。

### 成本和十五分钟采集约束

这项工作按客户提交的交易批次读取历史事实，日终或案件交付可以成立，不依赖一分钟 cron。十五分钟行情采集不是历史交易完整性或价格完整性的替代品。

小批量已知交易哈希可以限制读取量；全钱包索引、历史状态、trace、长期存储仍可能需要付费资源。若客户需要 TRON、Solana、已关闭交易所记录或链下账户，本次 EVM 起步范围不能直接承接。

每单应记录：

`交付成本 = 数据费用 + 开发工时 + 人工复核工时 + 客户沟通与返工工时`

`买方可量化收益 = 原流程人工成本 − 使用结果后的人工成本`

这里不预设报价。公开复杂税务服务价格只说明有人工支出，无法确定其中多少属于数据技术处理。首单应确认买方愿意付的技术子任务预算，再判断能否盈利。

### 竞争优势必须通过结果建立

可验证的优势是：客户已有软件处理不了的某一类交易，你交付的规则在多个案件中能复用，而且总成本低于客户反复手工修复。潜在积累包括客户批准的协议解释、真实异常样例、回归数据和导入适配。

这些尚未形成护城河。Koinly、CoinTracking、Cryptio 可补同样的适配；会计事务所也可能自己有链上分析人员。若只剩一次性杂活，收入可以存在，但不能据此宣传可扩展的软件业务。

## 七 PriorSeal 的独立评估

### 核心能力确实存在

PriorSeal 能绑定明确授权与指定 EVM 执行，包含单次使用、有效期、调用字段、顺序证据、最终性状态与可验证记录。交易观察器读取 ERC20 日志；绑定逻辑对无法唯一归属的多笔转账保留歧义。项目归档支持 writer/reviewer 与追加修订关系。

来源：[授权与执行范围](/Users/imokokok/Documents/PriorSeal/docs/product/first-release-scope.md)、[EVM 观察](/Users/imokokok/Documents/PriorSeal/src/infrastructure/blockchain/evm/observer.mts)、[绑定检查](/Users/imokokok/Documents/PriorSeal/src/domain/binding.mts)、[证据归档](/Users/imokokok/Documents/PriorSeal/src/application/archive/evidence-archive.mts)。

这些可服务于执行责任核验。它们不能直接变成发票对账、完整付款审批系统、稳定币支付处理器或对任何钱包路径的强制控制。

### 为什么买方已有预算仍不足以推荐它

Midas 的案例支持三方资金治理存在实际需求，但采购的整体方案包含执行前策略、钱包、模拟、网络覆盖和支持。不能将完整钱包基础设施的采购意愿，拆出一块未经确认的“独立收据预算”。[Fordefi 案例](https://www.fordefi.com/customer-stories/how-midas-brings-tokenized-investment-opportunities-on-chain-with-fordefis-defi-native-custody-2ti85)

Turnkey 已发布可验证策略决策，DFNS 已提供带签名和时间记录的审批轨迹。独立验证和签名不是 PriorSeal 独占能力。现有官方页面也不足以证明它们缺少你想提供的某种外部导出格式；这个缺口必须通过具体客户流程核对。[Turnkey](https://www.turnkey.com/blog/introducing-verifiable-policy-decisions)、[DFNS](https://dfns.co/policy-engine)

### 保留的客户筛选条件

只有同时出现以下事实，才继续验证 PriorSeal 的独立采购：

1. 一个具名审阅方需要检查授权与执行关系。
2. 当前钱包、执行系统及其正常导出不能满足明确字段或顺序要求。
3. 客户愿意在执行前接入，或者提供可验证的原始授权；事后不能补造事前授权。
4. 存在采购负责人和预算，且范围落在可支持的链与调用路径。

可能涉及跨组织委托操作或客户对服务商的执行抽查；这仍是待验证场景。本次没有把它晋升为已经有市场的第二赛道。若客户只需要内部审批或交易列表，应先比较其现有工具，避免无效接入。

## 八 潜在访谈对象与采购链路

此表仅列公开业务匹配，未联系、未确认采购意向，不是销售名单承诺。

| 对象类型或公开样本 | 应找的角色 | 要验证的事实 | 主要反证 |
|---|---|---|---|
| Aurum FSG 一类处理复杂数据的事务所 | 对账服务负责人、合伙人 | 是否反复为某种链上交易支付分析工时；是否愿意外包技术解析 | 已有内部专家，或每案都不可复用 |
| Chainwise CPA 一类加密会计团队 | 对账负责人、技术负责人 | 哪种协议数据仍阻碍交付，能否提供已批准的正确结果 | 已有软件与专业人员能低成本处理 |
| 中小 Web3 财务外包团队 | 财务运营主管 | 一个具体月结异常的耗时、预算和文件接口 | 工作规模过小，追加供应商不划算 |
| 现有财务软件的数据或集成团队 | 数据工程负责人、产品负责人 | 是否采购外部协议适配与维护，授权条款是否允许 | 通常自建、采购门槛高或不愿依赖小供应商 |
| 有外部执行服务商的 EVM 团队 | 运营负责人、安全负责人、实际审阅方 | 原始授权及执行材料具体缺什么 | 钱包供应商已满足、无额外采购预算 |

首批应优先验证有重复异常的专业服务团队。大型银行和机构软件客户用于证明需求结构，不能因其规模大就假设它们适合成为你的第一批买方。

## 九 两周验证方案与停止条件

以下时间、数量和阈值是建议的投入上限与验收标准，未与任何客户约定。没有安排外联或自动跟进。

### 第一周确认可以购买的工作

- 对 5 家匹配的会计或财务服务团队做问题访谈，索取最近一次具体异常、所用软件、处理耗时与验收方式。
- 争取至少 2 家提供已脱敏、允许使用的小批量样例，并说明正常软件支持为何未解决。
- 同时确认其现有软件和客户协议是否允许数据导出、技术分包与结果回导。
- 接触 PriorSeal 候选时，单独验证第七节四项条件；不把 Insight 样例或需求记为 PriorSeal 验证。

### 第二周完成一个有边界的付费交付

- 只选择一种确有重复问题的协议或交易路径，预先列出支持及不能判断的情形。
- 固定输入、正确结果的确认人、输出字段、返工范围、费用与数据处理方式。
- 测量实际减少的人工时间、客户接受率、未解决条目、数据成本和开发复用率。
- 只有新案件复用同一规则后仍有正向收益，才考虑产品化和订阅维护。

### 停止或改变方向的条件

- 5 家中没有团队愿意提供真实问题材料，或者全部只愿意免费交流。
- 问题通过现有工具的正常配置或客服即可解决。
- 主要困难是税务判断、链下记录缺失或无法取得的历史证据。
- 客户要求全链、全协议或完整税务交付后才肯付费。
- 每单都从头开发，含人工成本后持续亏损。
- PriorSeal 的候选始终没有具名审阅方、缺失材料清单和额外预算。

这些条件用于防止再次用开发进度替代需求验证。停止一个假设，不代表否定项目全部技术价值。

## 十 最终决策

**本次研究支持把 Insight 的下一步验证集中到 DeFi 财务数据异常修复。** 买方已有软件和人工处理支出，残留问题有公开依据，批量处理与当前基础设施约束相容。工程上可以从已有取数、事件解析和协议适配开始，但需要新的数据模型与客户验收，不能宣称已经完整实现。

**本次研究不支持为 PriorSeal 宣布一个新的独立付费赛道。** 其能力贴近授权执行核验，然而这一能力从成熟钱包方案中独立出来是否值得购买，仍缺直接需求证据。继续技术开发必须由真实采购条件触发。

若用户希望直接经营大规模订阅 SaaS、不能接受先做少量技术服务验证，那么本次最优候选也不满足这一偏好，应暂停第二赛道投入，而不是再换一个包装名称。

## 十一 来源与阅读范围

以下均为本次于 2026-10-03 检索或读取的公开材料。R 为研究背景，P 为公开价格，C 为供应商或平台报告的具名业务案例，D 为产品文档或限制。编号仅用于检索，不代表质量排名。

| 编号 | 来源 | 阅读范围与用途 |
|---|---|---|
| R1 | [McKinsey 与 Artemis 稳定币支付研究](https://www.mckinsey.com/industries/financial-services/our-insights/stablecoins-in-payments-what-the-raw-transaction-numbers-miss) | 2026-02-18 HTML 正文与年化脚注；区分流水与真实支付 |
| R2 | [McKinsey 2026 Global Payments Report](https://www.mckinsey.com/industries/financial-services/our-insights/global-payments-report) | 2026-09-25 公开 HTML 节选；没有声称通读 29 页 PDF |
| R3 | [EY 与 Coinbase 2026 机构调查](https://www.ey.com/en_us/financial-services/institutional-digital-assets-survey) | 当前调查摘要、采用及能力建设段落；意愿不是实际采购 |
| R4 | [Artemis 2025 研究发布说明](https://research.artemis.ai/p/what-are-stablecoins-used-for) | 2025-05-29 说明和样本结论；没有声称通读完整报告 PDF |
| P1 | [CoinTracking Full Service](https://cointracking.info/crypto-tax-full-service/) | 公开套餐价格与服务范围；不掌握成交金额 |
| P2 | [CoinTracking Corporate](https://cointracking.info/corporate-pricing/) | 多客户软件的公开年费与账户范围 |
| P3 | [Request Finance Pricing](https://www.requestfinance.com/pricing) | 原 request.finance 页面重定向到本页；月费、套餐功能与额外费用 |
| C1 | [Cryptio Reconciliation](https://www.cryptio.co/solutions/reconciliation) | 产品覆盖和 Circle、Transak、Securitize 具名反馈；未独立联系客户 |
| C2 | [Bitwave 与 FV Bank](https://www.bitwave.io/blog/fv-bank-case-study-challenge-bitwaves-solution-and-outcome) | 银行财务记录的集成案例；不推定合同金额 |
| C3 | [Kaiko 与 Recap](https://www.kaiko.com/resources/recap-client-story) | 估值数据的具体使用问题与供应商方案 |
| C4 | [Kaiko 与 Wyden](https://www.kaiko.com/news/wyden-and-kaiko-partner-to-deliver-institutional-market-data-for-benchmarking-performance-tracking-and-mica-compliance) | 2025-08-28 集成公告；不视为买方独立效果评估 |
| C5 | [CME 与 Kaiko 数据使用案例](https://www.cmegroup.com/articles/case-study/case-study-optimizing-access-to-cme-group-cryptocurrency-data-via-websocket-api.html) | 数据接入、消费成本和分发需求 |
| C6 | [Fordefi 与 Midas](https://www.fordefi.com/customer-stories/how-midas-brings-tokenized-investment-opportunities-on-chain-with-fordefis-defi-native-custody-2ti85) | 需求和方案段落；只用于判断采购内容，不引用规模或资金安全效果 |
| C7 | [Aurum FSG 服务商介绍](https://koinly.io/accountants/aurumfsg/) | 人工修复工作的业务范围；没有验证其是否采购外包 |
| C8 | [Chainwise CPA 服务商介绍](https://koinly.io/accountants/chainwise-cpa/) | 逐钱包对账与协议处理服务；没有验证采购意向 |
| D1 | [Koinly 产品比较说明](https://koinly.io/compare/cryptotaxcalculator-vs-koinly/) | 只采用对人工复核和自身覆盖的说明；不采纳其对竞争对手的优劣结论 |
| D2 | [Turnkey Verifiable Policy Decisions](https://www.turnkey.com/blog/introducing-verifiable-policy-decisions) | 2025-12-08 产品发布与验证能力；不是独立安全审计 |
| D3 | [DFNS Policy Engine](https://dfns.co/policy-engine) | 审批、签名记录及策略能力；不将供应商安全承诺当作独立验证 |
| D4 | [Request Finance API](https://docs.request.finance/) | 发票和状态跟踪接口摘要，用于理解现有流程覆盖 |
| D5 | [Request Finance 付款合约说明](https://help.request.finance/en/articles/10123680-smart-contracts-at-request-finance) | 自动对账与付款流程说明；不用于建议实际转账 |

其他检索到的宣传、搜索摘要和旧研究未作为核心结论依据。没有使用付费报告的未读部分，也没有把动态搜索抓取日期写成案例发生日期。
