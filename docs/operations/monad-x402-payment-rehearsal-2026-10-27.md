# Monad x402 Gate-2 付款演练记录 — 2026-10-27

状态: 两笔限额付款均结算并独立对账成功, Gate 2 通过。对账与证据的完整描述见
`~/Documents/PriorSeal-Evidence-20261027-monad-x402-gate2/RECONCILIATION.md`
与 runbook `docs/runbooks/monad-x402-commercialization-gate.md` 的 Gate 2 notes。

## 摘要

- 付款钱包 (专用): `0x1BF19c0e42f5cCcf8261dabFd755b827a2091DeC`; 网络 Monad `eip155:143`; 收款方 `0x5FBbbCbF2Ade44F5c604E5E55f11945E1ADdD231`。
- Insight: `GET /api/v1/safety/pre-trade` (asset=ETH, destinationAsset=USDC, chainId=143, action=swap, tradeAmountUsd=1, schemaVersion=3), 结算 20000 atomic, tx `0x7363e7c2d3c5de24cf6a6232f6595db9fd142ca0a97410fe1fc05142ec44cff6`, verdict PASS, attestation UID `0xc9b331120f21e066d5008ad70ead6f7172cabc768a7be7bfca1b4724d379580f` (attester = 生产 oracle-keys `insight-oracle-safety-v2-202609`)。
- PriorSeal: `GET /v1/integration-readiness?chainId=143&subjectAddress=0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` (ERC-8004 Identity Registry; `getAgentWallet(10414)` 链上返回同一收款地址), 结算 20000 atomic, tx `0x9670574f248c792156171a0556efbc2efc4ca07ab96601d8c15b196f841c3e0f`, 报告 `pir_c6ff9896e8789f842a7b456ee47990c6`, Ed25519 `production-1` 签名经线上 key registry 校验通过。
- 钱包 USDC 差额恰好 40000 atomic (0.04 USDC), 无多余扣款。
- 授权边界: 每笔一次签名请求, 无重试; 主体交易零签名零广播; 私钥仅存 0600 env 文件并即时删除。

## 偏差

- 计划截图中的 `stg.priorseal.xyz` 无 DNS 解析; 实际使用 Gate-1 报价检查验证过的生产端点 `priorseal.xyz` (其余条款不变)。

## 后续发现与修复

1. **已修复（2026-10-27）**：生产 Worker 现已配置加密的
   `PRIORSEAL_RPC_MONAD` binding；其值未写入仓库或文档。该 binding 已加入
   `wrangler.jsonc` 的生产必需 secret 清单，并已重新生成 Worker 类型。部署前
   的 Gate-2 readiness 报告中的 `subject.kind=NOT_OBSERVED`、
   `chain.rpc=NOT_CONFIGURED` 因而仅是当时的历史状态，不能再作为当前配置结论。
   这项修复不产生付款、不签名、也不广播业务主体交易。
2. **仍待 Gate 3 的独立验证**：只有在另行获授权的完整客户路径中，才会取得一份
   使用新 RPC binding 的签名 readiness 报告，并验证其中
   `chain.rpc=AVAILABLE`、`observedChainId=143` 与实际主体合约字节码。不能把
   “secret 已部署”误报为已经完成的 Gate 3。
3. `priorseal.xyz` 对本地直连连接复用会 RST；一次性演练客户端已改走本地代理
   (undici `EnvHttpProxyAgent`)。集成客户端必须在签名前完成传输预检，且不得对
   已签名付款自动重试。
4. 便携回执导出 `GET /v1/receipts/:id/bundle` 本身按 x402 计费 ($0.02)，本次未
   购买；如需该产物，必须另行授权。
