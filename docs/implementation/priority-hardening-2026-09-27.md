# 优先技术补齐：实现与验收

日期：2026-09-27，Asia/Shanghai。范围为前次建议的前三项：独立验证器交付、来源分类与新鲜度、一个完整执行适配器。

**三个优先项的代码、本地验收及独立验证器 npm 公开发布已完成。当前消费者固定版本为 0.3.1，见文末补丁验收。** 本文及机器记录保存 npm 发布完成时、Git 交付前的验收快照；后续提交、推送和自动部署结果以两个仓库的远端 SHA 与 CI 为准。生产数据库迁移和合作方资金交易不在本次执行范围。

## 1. 独立验证器

Insight 的 [`verify-insight-receipt@0.3.0`](https://www.npmjs.com/package/verify-insight-receipt/v/0.3.0) 已公开发布，支持历史 v1–v4 和当前 v5 ExecutionReceipt。新增：

- 精确 UTF-8 字节的 SHA-256 注册表固定与严格解析，拒绝模糊列表、重复身份、无效时间和哈希不匹配。
- 本地文件离线 CLI `verify-insight-offline`，输出验证结果、注册表哈希及字节长度，并通过退出码表达失败。
- 非法配对 UID 返回失败，避免未捕获的哈希异常。
- 发布前验收与 CI：测试实际打包产物，在临时消费者里安装，验证 CommonJS、ESM、Chromium、所有历史布局、篡改、撤销、样本密钥、未知 v5 profile 和历史配对。

发布包与其验收清单在 Insight 的 `.local/verifier-release/`。包 SHA-256：

`7e480c4fe9ff14b0a770e42c012cccead5c446efe1fed55000611ca38f4c50ab`

包大小 28,757 字节；独立消费者使用 Viem 2.56.9。清单同时记录 npm integrity 与消费者 lockfile 哈希。预期注册表哈希必须来自消费者独立审阅的配置；签名/哈希匹配不能代替发行者信任。

**公开发布验收：** 用户完成 npm 网页登录与发布认证后，同一 tarball 已发布，公开 `latest` 为 0.3.0。2026-09-27 23:23:26（北京时间）从 npm 重新下载，核对 SHA-256、大小与 integrity 完全一致，再在独立消费者中通过 CJS、ESM、全部历史布局、离线 CLI、失败场景和实际 Chromium 验证。Insight 根依赖和 PriorSeal SDK 源码依赖均固定为 0.3.0，lockfile 同步；PriorSeal 的既有 `insight-execution-v5` 模块改为上游包的兼容再导出，避免重复维护并采用非法 UID 失败处理。PriorSeal SDK 自身没有发布新 npm 版本；此次 SDK 源码更新随仓库交付，SDK 独立 npm 发版状态仍以注册表为准。

## 2. 来源分类与新鲜度

Insight 的公开诊断输出明确标记 `insight.coverage-diagnostic.v2`，并给出分类/新鲜度 policyId。诊断与签名覆盖评估复用同一个观测转换过程：

- 未分类来源的 group 为 null，不计入参与者或独立来源组；Band 使用明确分类，TWAP 保留派生属性。
- 实际链、资产、USD 计价、显式 quorum 标记、有限正价格、重复来源和共识排除均参与资格检查。
- 来源年龄必须有 `provider_age` 或 `provider_timestamp` 的时间来源。拒绝负数/非有限年龄、未来时间、旧检索时间及缺失来源时间。
- 两种年龄信号矛盾时采用较旧的信号；检索时间不能单独证明来源新鲜。
- 可用性、符合新鲜度预算的覆盖和签名状态分别表达。诊断不签名，也不构成交易安全或生产 SLA。

冻结的历史 source-group 映射、签名布局、coverage policy、密钥和九个合作方激活配置保持原语义。新增 promotion v22 与完整兼容矩阵已注册；严格证明/新快照接口需要显式采用。分类表表达已审阅的来源分组，不声称密码学证明上游独立性。

## 3. 执行适配器

PriorSeal 新增可选 Node/PostgreSQL 执行边界，运行方法见 [运行说明](../runbooks/rwa-node-executor.md)。

- 数据库同时原子占用授权 ID 和 `(chain, sender, nonce)`，多实例共享同一张表。
- 状态转换使用原子 compare-and-set，拒绝竞争更新；拒绝、异常和终态都不释放 claim。
- Viem 本地账户适配器核对签出原始交易的发送者、链、目标、calldata、value、nonce，并检查 RPC 返回哈希。
- 准备交易后、签名后再次检查授权状态与证明有效期；阻止准备期间撤销/过期后的广播。
- 广播禁用 request retry；拒绝会内部换节点重发的 fallback transport。自定义 provider 也必须禁用内部重发。
- 响应丢失、数据库结果不确定和进程/数据库恢复进入观察与对账流程。恢复不能清空或替换已保存的交易哈希。

本地 EVM 演练经过实际授权入口、原始交易广播、两笔 ERC-20 转账、接收者余额核对和回执验证；数据库恢复后没有第二次广播。测试资产、路由器、发行者事实和报告均为 simulation，不等于生产 RWA 资格、储备或法律权利已验证。

Cloudflare/D1 的公开证据服务托管保持原配置；新执行器属于 Node 路径。所有签名者入口必须共享这个边界，直接绕过它签名不受其保护。

## 验收证据

| 项目 | 结果 |
| --- | --- |
| Insight 全套 Jest | 2242 通过，1 个原有跳过 |
| Insight SDK / reliability | 183 / 30 通过 |
| 最终相关接口、配对、注册表回归 | 87 通过 |
| npm 公开发布包 | 注册表版本、latest、tarball 哈希及 integrity 一致；CJS、ESM、CLI、Chromium 通过 |
| Insight 应用构建 | Webpack 构建通过；首页初始 JS 306 KB gzip，预算通过 |
| PriorSeal 全套测试 | 升级公开验证器依赖后再次 395 通过 |
| 本地 RWA EVM 演练 | 1 次广播、2 笔实际本地转账、最低输出/余额核对通过、恢复重放被阻止 |
| 协议与源代码检查 | promotion 哈希、源锁、生成文件、TypeScript、lint、format、工作流检查通过 |

本机 Turbopack 构建被沙箱内部端口限制阻止，因此使用 Webpack 验证；生产发布仍应通过仓库的同提交 CI 与浏览器 gate。真实 PostgreSQL 17 并发测试已接入 CI，本地数据库测试使用 PGlite。远端结果见 [PriorSeal CI](https://github.com/imokokok/PriorSeal/actions/workflows/ci.yml) 与 [Insight Quality Gate](https://github.com/imokokok/Insight/actions/workflows/ci.yml)。本次没有将 simulation 或本地测试标记为生产客户证据。

发布后的消费者验收还包括 PriorSeal SDK 构建及 Insight TypeScript 检查，均通过。公开包验收清单在 Insight `.local/verifier-release/registry-verification.json`，同时复制进下方机器记录。

机器可读结果及源文件/原始日志哈希见 [验收记录](priority-hardening-2026-09-27.json)。

## 最终补丁与远端交付：2026-09-28

最终复核复现了快照角色数组被字符串转换接受的问题；`0.3.1` 改为严格要求字符串角色，发布包测试覆盖 sample 和 attester 两种数组的拒绝。公开 npm tarball 与通过 Chromium 的验收包逐字节一致，SHA-256 为 `0b8295574e63602fbebdaa9084d83e336c866a653a8d7c919e964fce3d9d5194`，28,947 字节；独立注册表消费者的 CJS、ESM、CLI、历史与失败场景全部通过。两个项目的依赖均固定为 0.3.1；PriorSeal SDK 构建与 59 项相关消费者回归通过。此前 0.3.0 的记录保留为历史验收。

PriorSeal 首批优化提交 `f61bc0400d150a82cdd5872c95e628c1c9927cf7` 已核对远端 main，且 [正式 CI](https://github.com/imokokok/PriorSeal/actions/runs/36331033284) 全部通过：真实 PostgreSQL 17、完整测试、浏览器与本地 EVM 演练。补丁后的最终仓库验收以对应 SHA 的最新 CI 为准。Insight 通过 [PR #50](https://github.com/imokokok/Insight/pull/50) 交付 main，并遵循三项必需检查及用户明确授权的自动部署。

补丁包与源码/日志哈希见 [补丁验收记录](priority-verifier-patch-2026-09-28.json)。
