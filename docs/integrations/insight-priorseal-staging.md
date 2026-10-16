# Insight + PriorSeal 隔离 staging 验收

更新时间：2026-10-16（Asia/Shanghai）

## 验收目标

在没有生产资金、生产数据库和生产签名身份的环境中，完成一笔测试交换的完整证据链：

1. Insight 返回源资产与目标资产的签名决策输入和预交易证明。
2. Insight Guard 独立验证签名、交易范围和具体 V3 call 模拟。
3. PriorSeal 接受一次性授权，并在广播边界复核完全相同的交易。
4. 仅向隔离测试链广播；PriorSeal 观察交易并签发可独立验证的回执。
5. Insight 为同一交易签发真实签名执行回执；最终报告关联评估 UID、授权、交易哈希和两侧回执。

本地演练入口是 `scripts/insight-priorseal-v3-local-drill.mts`。它通过 Insight 当前源码中的 `issueExecutionReceipt` 收集 Ganache 交易事实并签发 v5 回执，再调用 Insight 的回执验签和双预交易配对验证；PriorSeal 回执也会独立验签，最终核对两侧交易哈希。该演练使用本地 fixture signer、Ganache 和 PGlite，不调用托管 Insight API、不写入 staging 存储，也不构成 staging 验收证据。

运行前先在 Insight 仓库执行 `npm run sdk:build`，再在 PriorSeal 仓库执行 `npm run sdk:build && npm run core:build`，最后从 PriorSeal 仓库运行：

```sh
GANACHE_MODULE=/path/to/ganache/dist/node/core.js \
TSX_TSCONFIG_PATH=../insight/tsconfig.json \
  node --import ../insight/node_modules/tsx/dist/loader.mjs \
    scripts/insight-priorseal-v3-local-drill.mts
```

## 当前 staging 阻塞项

- Insight Vercel Preview 的变量元数据显示，下列变量同时面向 `preview` 与 `production`：`NEXT_PUBLIC_SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`ATTESTATION_SIGNER_PRIVATE_KEY`、`ALCHEMY_ETHEREUM_RPC`、`JWT_SECRET`。变量值未读取。当前 Preview 不能视为隔离环境。
- Insight 的 Supabase 项目清单中没有 staging 项目，Insight 项目也没有 preview branch。不能将生产数据库分支、密钥或样本客户数据当作 staging。Supabase Preview branch 默认不复制生产数据，但按运行时长计费，创建前需要确认成本和保留方式。
- PriorSeal 已有独立 `priorseal-staging` D1；逐项对比确认其表和索引与 `0001_initial.sql` 一致，并将该基线登记进 staging 迁移账本。独立 `priorseal-staging-observations` 队列也已创建。`wrangler.jsonc` 现在含隔离的 `staging` 环境配置，Worker 尚未部署；独立 issuer 密钥、测试 RPC secret 尚未配置。
- 两个仓库都没有 `.env.staging`。现存 `.env.local` 不应被当作 staging 配置。
- Insight 当前严格 Decision Input V3 路由只支持 Ethereum 主网：决策输入 schema 将链 ID 限定为 `1`，独立 Uniswap V3 路由报价也拒绝其他链。严格 SDK 要求决策输入、预交易证明和待执行交易处于同一链。因此，现有严格路径不能直接在 Base Sepolia 执行。

在这些条件解除前，不得向 Preview 发送组合交易请求，不得执行真实主网交易，也不得把合成回执描述为已完成的 staging 证据。

## 建立隔离环境

### Insight

- 建立独立、无生产数据的 Supabase staging branch 或项目；当前账户没有现成 Insight staging branch。不要复制生产客户或密钥数据。
- 将当前数据库迁移应用到 staging，并单独验证决策输入、审计和执行回执表。
- 生成独立的 Insight attester；其地址必须与生产 attester 不同，并固定在验收配置中。
- 为独立的 Vercel staging/preview 部署设置 staging Supabase URL、service-role key、attester key、RPC 和应用密钥。现有 Preview 变量也面向 Production，不能直接用于这次验收或在未隔离时覆盖。

### PriorSeal

- 部署 `wrangler.jsonc` 的 `staging` 环境；其 D1、队列和限流命名空间已与生产分开，不得把配置改回 `priorseal-production` 或 `priorseal-observations`。
- 生成独立 issuer/key ID、授权 audience 和策略。staging issuer 与 `priorseal.xyz` 生产 issuer 必须不同。
- 只配置隔离测试 RPC 与测试链策略；staging 策略拒绝生产链和未列入白名单的 router/token。

### 交易网络

为严格 V3 路径选择一种明确的隔离方案：

- 推荐新增并审查一个测试链 Decision Input 配置（例如 Base Sepolia）：测试链资产/feed、独立报价路由、双 RPC 一致性和测试策略都必须一起支持。仅放宽链 ID 校验不构成支持。
- 或使用受控的链分叉环境，并确保 Insight 回执服务、PriorSeal 观察器和执行客户端都能访问同一分叉状态；不得把分叉交易广播到公共主网。

## 验收门槛

1. 只读健康检查通过：Insight `/api/v1/health`、`/api/v1/health/ready`；PriorSeal `/health/live`、`/health/ready`、`/v1/capabilities`。
2. 独立核对 staging Insight attester、PriorSeal issuer/audience、数据库项目标识和 RPC chain ID；任何一个与预期不符即停止。
3. 成功路径中记录真实签名的两侧预交易证明、Decision Input、精确交易模拟、PriorSeal 接纳回执、测试交易收据、Insight 执行回执和两边独立验签结果。
4. 拒绝路径至少覆盖：过期/篡改决策输入、超出滑点或报价范围、交易 calldata 改动、重复授权、RPC 不一致。
5. 恢复路径覆盖：授权后请求超时、交易广播后回执暂不可用；恢复只能查询/补取证据，不得重复广播。
6. 所有最终证据可从 staging 存储中取回；不得记录私钥、API key、service-role key 或 RPC URL 中的凭据。

## 交付证据

验收包至少包含：staging commit/build 标识、环境身份与 chain ID（不含密钥）、决策与授权 UID、交易哈希、Insight 与 PriorSeal 回执、独立验签结果、拒绝/恢复用例结果和最终证据状态。标明测试网/分叉范围，不将结果外推为主网安全保证。
