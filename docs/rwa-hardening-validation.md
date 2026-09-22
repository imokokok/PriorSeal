# RWA 代码加固验收（2026-09-20）

## 结论

上一轮审查的六项加固已落实，**新增 RWA v2 本地联合流程跑通**；
旧 RWA v1、Agent/DeFi 与原授权/回执接口没有被替换。
按用户要求准备将两个仓库全部改动推送 main 时，再次进行了整库复验：
先前预言机目录改动中的两个阻塞已消除，Insight 的 `validate` 与全局格式检查、
PriorSeal 的 `check` 均通过。这仍不是线上生产 RWA 交易已激活的证明。

## 实际验证结果

| 范围 | 结果 |
| --- | --- |
| PriorSeal 全工程 `npm run check` | 通过：语法、格式、类型、3 个 Solidity 合约/接口、测试、SDK/Web 构建、性能门槛 |
| PriorSeal 最新全测试 | 312 / 312 通过 |
| PriorSeal 覆盖率门槛 | `npm run test:coverage` 通过，未降低门槛 |
| PriorSeal RWA 专项 | 66 / 66 通过（已计入全测试） |
| Insight SDK | 168 / 168 通过，包含旧 Agent/coverage 回归及 v1/v2 冻结向量 |
| Insight HTTP / 诊断专项 | 7 / 7 通过（含 uint256 边界、结构化错误、公开 schema 一致性） |
| Insight 可靠性 | 12 / 12 通过（含新增连续推广链防回滚/断链测试） |
| Insight 协议治理、主类型、脚本类型、knip | 分别通过 |
| Insight 本轮相关文件 lint | 通过 |
| Insight 整站生产构建 | `npx next build --webpack && npm run perf:budget` 最终通过：首页 304 KB gzip |
| 两仓库源码锁 | 双向 `rwa:parity -- --peer ...` 通过，漂移负例测试通过 |
| 两个实际 SDK 联合流程 | `node examples/rwa-v2/verify.mjs ../insight` 通过 |
| CI 单仓库流程 | `npm run rwa:verify` 通过，使用固定摘要的 vendored producer |
| Insight 全量 Jest | 推送前复验：2047 通过、0 失败、1 既有跳过 |
| Insight 全量 `validate` / `format:check` | 推送前复验均通过 |

默认 Turbopack 在首版验证中受本地端口权限限制，因此本轮明确使用 Webpack；
没有将 Webpack 成功标成默认 Turbopack 成功。构建保留第三方依赖/chunk 提示，
未改写预算或隐藏警告。没有跑本轮全套浏览器 Playwright E2E 或真实网络交易。

## 新增安全行为已验证

- 同秒 authority/execution 通过签入序号和前序摘要配对；错误序号/前序被拒绝。
- 密钥排列和合法地址大小写差异不误拒绝；撤销、环境和策略差异仍拒绝。
- 解码并重编码 actual calldata，核对资产、方向、数量、接收人、最小到账、
  fee、deadline、native value；未知调用拒绝。
- 两个并发高层调用只进入一次广播回调；6 个独立 OS 进程只产生一个 nonce 占用。
- 越界时钟、锁冲突、损坏日志、签名错误、篡改调用不进入广播回调。
- 广播响应丢失后保留 UNCERTAIN；重新打开持久目录仍不重发。
- 提交前/后存储错误保留占用；恢复只核对观察结果，不自动广播。
- 真实签名但 REVERTED、错误接收人或不足到账的回执保留 integrity=PASS，
  同时拒绝 execution/admissible；篡改签名内容则 integrity=FAIL。
- 修改共享源码、修改冻结向量、两边锁版本不同，都会使对应检查失败。

## 联合运行记录

完整输出见 [verification-result.json](../examples/rwa-v2/verification-result.json)。

`integrity/trust/claims/time/policy` 全部 PASS，
`execution=SATISFIED`，`externalChecks=NONE`，`admissible=true`；
持久化提交回调次数为 1。随后构造的“真实签名但不足到账”回执被拒绝。

签名、授权、文件持久化、恢复和验证代码都实际执行；
数据、合约地址、广播结果、链观察均为明确标注的 **SIMULATION**。
网络请求为 0，不证明真实购买股票或链上最终性。

## 初次验收发现的问题及推送前复验

1. Insight `src/lib/oracles/services/chainlinkOnChainService.ts:238`：
   新增 metadata cache 表达式曾存在 Prettier 换行错误；现已通过全局格式检查。
2. Insight `src/lib/reports/__tests__/feedLifecycle.test.ts:160`：
   `keeps rediscovered recovered feeds active and clears prior health failures`
   曾预期 `row.is_active=true`、实际为 false；最新发现流程和测试修复已在工作区，
   推送前复验通过，测试预期没有被改成接受失败结果。

这些文件涉及执行期间另一项预言机目录/发现逻辑工作，首次验收没有覆盖其逻辑。
用户随后明确要求全部代码推送 main，因此本次纳入这些现有改动，并仅额外整理
测试文件格式。没有修改测试预期或跳过失败测试。最终整站 Webpack 构建亦已成功。

## 上线边界

详见 [实现与操作说明](rwa-hardening.md)。
新增持久适配器仅支持单主机共享持久文件系统，不是 Workers/多机分布式存储。
新语义适配只覆盖明确准入的原版 Uniswap V3 exactInputSingle ERC-20 买卖。
生产数据认证、真实发行人资格、合约部署准入、线上最终性、密钥运维与限额试点
尚需实际接入验证；没有宣称全品类 RWA 或生产交易已经可用。

初次验收没有 Git 提交/推送。本次按用户明确要求提交并推送两个仓库的 main；
远程结果以推送后的 SHA 核对为准。未手动发布 npm、部署云服务、购买数据或广播
资金交易。main 推送可能触发现有 CI 与其已配置的部署流程，需另查 CI 状态。
