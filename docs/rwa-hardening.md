# RWA v2 加固与接入边界

本轮针对上一轮审查的六项问题进行增量加固。v1 签名域、原 Agent/DeFi API、原授权和回执格式保留；没有自动把现有用户迁移到 RWA。

[最新验证结果与历史问题复验](rwa-hardening-validation.md)：本地 RWA 联合流程与推送前整库检查通过，不等于生产 RWA 交易已激活。

## 已实现

| 问题 | 处理 |
| --- | --- |
| 高层入口可遗漏主体授权和原子占用 | Node 应用层 `executeRwaAuthorized` 强制验证主体签名、受信 acceptance、intent/执行人/audience/策略/时间范围，然后占用授权 ID 与 chain/sender/nonce，再进入广播回调 |
| 同秒报告、密钥排列误拒绝 | 独立 RWA v2 EIP-712 域签入 sequence 与 previousDigest；执行报告必须严格后继且时间不倒退。同秒可配对。可信密钥数组按地址规范化排序，但不忽略撤销或有效期差异 |
| HTTP / SDK uint256 不一致 | 同一精确十进制 uint256 正则用于 SDK、Zod、公开 JSON Schema。越界保留字段、稳定错误码和 retryable=false |
| 只检查 calldata 哈希 | v2 解码已准入 ABI，再编码比较；核对输入/输出代币、方向、输入数量、receiver、fee、deadline、native value；接收人资格另行签入、限定来源和有效期 |
| 真实失败混同伪造证据 | `inspectRwaReport[V2]` 和 `inspectRwaReceiptBundle` 分离完整性、信任、时间、策略、执行与外部检查；真实签名的 REVERTED / 不足到账不再等同篡改 |
| 两仓库静默漂移和薄弱故障回归 | 两仓库共享源码摘要锁、冻结 v1/v2 签名向量、CI 检查；新加边界/性质、多进程竞争、时钟跨界、损坏日志、响应丢失、恢复测试 |

## 如何接入

在 PriorSeal 仓库先执行 `npm run sdk:build`。服务端推荐从 `src/index.mjs` 导入
`executeRwaAuthorized`、`createRwaAttemptStore` 和 `reconcileRwaAttempt`。

```js
const attempts = createRwaAttemptStore({
  directory: '/your/private/persistent/priorseal-rwa-journal',
});

const result = await executeRwaAuthorized({
  authorizationId,              // 已由 authorizeIntent 接受的授权
  intent, authority, execution,  // authority/execution 含 proof 与独立固定的 trust
  authorityTime,
  transaction,                  // 实际准备广播的完整交易
  audience: 'priorseal',
  acceptanceKey,                // 独立固定的 PriorSeal 发行公钥，不从 bundle 自信任
}, {
  authorizationStore,
  attempts,
  submit: broadcastExactTransaction,
});
```

广播函数必须使用收到的**原样交易**，不能在钱包中重选 nonce、接收人或 calldata。
`submit` 返回已广播的交易哈希。SDK 的 `withRwaBoundIntent` /
`withRwaExecutionPair` 仍是低层组合工具，不自行验证主体或持久化防重放；
不要把它们单独作为新业务的安全执行入口。

## 持久化与恢复

状态流程：RESERVED → SUBMITTING → SUBMITTED → CONFIRMED/REVERTED。
提交前确定失败可变为 REJECTED；广播可能发生但结果未知则保留 UNCERTAIN。
所有状态都保留授权及 nonce 占用，**没有超时释放和自动重发**。

- 日志使用同目录原子锁、文件 fsync、rename、目录 fsync。独立进程共享同一个目录。
- 持久化失败或进程崩溃留下的锁不自动抢占；不要简单删除日志重试。
- 若收到错误，先查询 `attempts.get(authorizationId)`，不要把错误等同“没广播”。
- `reconcileRwaAttempt` 只接受受信观察器提供的最终状态和完全匹配的实际交易；
  它不会广播，也不会释放不确定 nonce。已确认状态可幂等修复授权绑定。
- 日志锁恢复需要先停止所有该 signer 的执行器、备份和核查日志/链状态，
  确认没有活跃写者后由运维恢复锁；不得以恢复名义重置占用。

该实现是**单主机持久文件系统**适配器，不是分布式租约，不适用于临时磁盘、
多机独立目录、NFS 或 Cloudflare Workers 文件系统。所有同一 signer 的写路径
必须使用同一占用服务。横向部署需要实现相同原子语义的持久适配器并重跑故障测试；
本轮没有新建生产表、配置云服务或宣称已覆盖这些部署形态。

## 当前语义支持范围

只有原版 Uniswap V3 SwapRouter 的带 deadline 的 `exactInputSingle`，
且是 ERC-20 → ERC-20、buy/sell、非零 amountOutMinimum。
`request.amount` 明确是**输入代币最小单位**，buy 时通常是报价代币数量。
不是 SwapRouter02，不支持 multicall、permit、原生币、ERC-4626、
任意 RWA mint/redeem/transfer 或所有发行人协议。未准入方法拒绝，不猜测。

消费者必须独立准入链、router 部署/实现、instrument 与 quoteToken。
不能只因为地址或 ABI 匹配，就认定部署可信。最终成交检查基于签名观察结果中的
ERC-20 Transfer 日志：发送方输入资产净支出精确匹配、接收人输出净到账达到下限、
不出现额外资产支出。手续费代币、rebase、部分成交等非标准行为没有默许支持。

v2 同时要求发送方和实际接收人的资格证据，但资格断言仍需要发行人/合规系统真实提供；
这不是法律合规证明。市场、储备、公司行动和证券权利仍不能由普通价格源推导。

ERC-1271 授权需要提供实际在线验证回调；离线回执明确显示仍需外部检查。
新高层执行器对需要 RFC3161 / witness 策略的请求暂时 fail-closed，
不绕过其外部验证。原有时间戳/见证 API 与回执验证能力不变。

## 可重复验证

在 Insight 仓库：`npm run sdk:test`、`npm run test:reliability`、
`npm run rwa:parity -- --peer ../PriorSeal`。

在 PriorSeal 仓库：

```sh
npm run check
npm run test:coverage
node examples/rwa-v2/verify.mjs ../insight
```

联合示例加载两个实际编译的 SDK，完成：
Insight 签名 → 主体签名/接受 → v2 同秒配对和语义准入 →
持久化单次提交 → 重启重放拦截 → 模拟观察恢复 →
PriorSeal 签名回执 → 联合离线验证，并拒绝真实签名的不足到账。

CI 每个仓库核对同一版本的源码/向量摘要锁，修改共享实现必须显式更新锁；
本地 `--peer` 还核对另一工作区。它不偷偷同步或发布对方仓库，
也不能替代发布时检查两边提交版本。新增 v11 推广只追加，
保留 v10 与全部既有 activation/policy；治理检查允许一条严格连续的新增版本链，
仍拒绝历史修改、断链、孤立记录和回滚。

[本地联合输出](../examples/rwa-v2/verification-result.json)全流程成功、网络请求为 0。
所有数据、部署、观察和公开私钥都是 SIMULATION。
未执行真实广播、发布、部署或 Git 推送；**本地通过不等于生产已上线**。
