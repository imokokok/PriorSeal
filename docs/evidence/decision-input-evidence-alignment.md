# 决策输入证据层：与 AAT / SCITT 的对齐声明（公开发布版 v1.0）

日期：2026-11-15 · 状态：公开发布，可被第三方引用 · 范围：Insight + PriorSeal（oracleinsight.xyz / priorseal.xyz）

> English abstract: This note maps two MIT-licensed production services onto the cryptographic evidence mechanisms of `draft-sharif-agent-audit-trail-09` and SCITT. It explicitly does **not** claim AAT/SCITT conformance, RFC 8785/6962/3161 conformance, or regulatory compliance. All capability statements describe implemented code; deployment status is stated separately. See `README.md` in this directory for the offline verification recipe.

## 0. 定位（先说清不主张什么）

两个项目提供的是**「决策输入的可独立复验证据层」**：在一次链上动作发生之前，把"当时依据了哪些输入、哪些被排除、依据什么规则得出判断"固化成可离线复验的签名证据，并把它锚进一条 append-only 透明度日志。

本文**不主张**：AAT 一致性（conformance）、EU AI Act 或其他法规的合规结论、任何形式的认证。
`draft-sharif-agent-audit-trail-09` §11 自己声明其监管映射是 informative，"not a compliance assessment"。本声明沿用这一克制。

一句话结论：**我们覆盖的是 AAT 的密码学证据机制子集，不是 AAT 的 agent 日志语义层。** 这两层必须分开说，混在一起说会立刻失去审计方的信任。

## 1. 为什么现在写

- 采购/审计侧的判据正在收敛为 *portable, signed, available for offline verification*；IETF `draft-sharif-agent-audit-trail-09`（2026-10-26）、EU AI Act Art.12、中国 2026-11-05《智能体规范应用与创新发展实施意见》都指向防篡改留痕 + 第三方独立核验 + 多轨留存。
- 这些买家不在 x402 服务目录里找能力，他们在草案、条文与审计报告里找**能被引用的格式**。
- 两个项目的相关能力已建成，但此前只以「$0.02 按次判断的 API」对外表述，导致标准/证据线长期被当成"分发尝试"，用结算笔数衡量因而全部显示为失败。

## 2. 逐条能力映射（AAT -09）

### 2.1 密码学证据机制：已实现

| AAT -09 条款 | 要求 | 本地实现 | 状态 |
|---|---|---|---|
| §6 / §6.1 / §6.3，`prev_hash` | 防篡改哈希链，逐条引用前一条 canonical JSON 的 SHA-256 | PriorSeal `src/domain/transparency.mts`：`TransparencyEntry.previousEntryHash`，`entryHash = hashJson({sequence, authorizationHash, acceptedAt, previousEntryHash})`；`verifyTransparencyEvidence` 逐条校验链连续性 | 已实现，**编码不等价**（见 §3） |
| §6.4 Merkle batch anchoring | RFC 6962 树 + 紧凑 inclusion proof | PriorSeal `src/domain/merkle-log.mts`：domain-separated power-of-two 树，`merkleLeafHash` / `merkleParentHash` / `verifyMerkleProof`，O(log n) proof；checkpoint v2 带 `merkleRoot` | 已实现，**构造不等价**（见 §3） |
| §3.2 `external_timestamp` / §6.4 external anchoring | 外部存在性时间证明，L3+ 推荐 | **生产**：`file-anchor-provider.mts` 文件锚记录 + issuer 签名 checkpoint。**另有已实现并测试、但未在生产启用的可选项**：`type=eip155` 链上 `anchor(uint256 size, bytes32 head)` 交易，含独立 RPC 复验 tx / receipt / blockHash / block.timestamp / calldata 解码 / 确认数 | 语义已实现；**链上锚非现役部署**，且载体不同（非 RFC 3161 TSA token） |
| §4 Pre-execution recording | 记录必须早于动作，证明是策略执行而非事后观察 | `transparency.mts` 的 `TRANSPARENCY_AFTER_EXECUTION`：锚晚于执行直接拒；Insight 全部 guard 为 `pre-trade` / `pre-signing`，明确 "never signs, broadcasts or authorizes" | 语义已实现，**缺 `record_phase` 显式字段** |
| §13.6 Attestation closure（输入侧） | 证据闭包必须可独立重算，不能靠自述 | Insight `src/lib/attestations/providerObservationsHash.ts`：把 provider 观测集合（含被排除项及 `exclusionReason`）哈希进 EIP-712 签名；发布 `PROVIDER_OBSERVATIONS_HASH_CANONICALIZATION` 与导出 ABI，使独立验证者无需猜测 tuple 类型 | 输入闭包已实现；**模型闭包不覆盖**（见 §2.2） |
| 可移植 / 离线验证 | 证据可导出、签名、无需厂商服务器复验 | PriorSeal `src/domain/verification-bundle.mts`：`priorseal.verification-bundle.v1` + `bundleHash`；`VERIFICATION_BUNDLE_TRUST = PIN_ISSUER_KEY_OUT_OF_BAND`，并明示 "Bundled keys are discovery metadata, not an independent trust anchor"；`ed25519.mjs` / `canonical-json.mjs` 仅依赖 `node:crypto` | 已实现，**零第三方依赖** |

### 2.2 AAT 日志语义层：明确不覆盖

§3.1 的 13 个必填字段中，除 `prev_hash` 的近似对应外，以下均**不提供**，且不应在对外材料中暗示提供：

`record_id`（UUIDv4）、`timestamp`（RFC 3339）、`agent_id`、`principal`（含 `principal_type` / `principal_id` / `authority_ref`）、`agent_version`、`session_id`、`action_type`（7 类动作词表）、`action_detail`、`outcome`、`trust_level`（L0–L4）、`parent_record_id`、`record_phase`。

§13 的 decision reproducibility 要求覆盖模型权重、tokenizer、chat template、推理引擎构建与数值环境；两个项目只覆盖**数据输入闭包**，不覆盖模型闭包，因此不得声称 `reproducible`。

> 这个边界不是缺陷陈述，而是产品定位：我们记录"决策依据了什么"，不记录"agent 是谁、代表谁、按什么权限做了什么"。后者应由 agent 平台自己的日志层承担，我们的证据可作为其 `action_detail` 中的可验证附件。

## 3. 与三项基础的编码差异（对外必须写明，不得含糊）

| 项 | AAT 引用 | 本地实现 | 影响 |
|---|---|---|---|
| 规范化 | RFC 8785 / JCS | `canonical-json.mjs` 的 `canonicalize`：键排序 + `JSON.stringify` 数值 + 拒绝非 plain object / 非有限数 / 不安全键 | **2026-11-15 实测：§3.2.2 参考样例逐字节一致，Appendix B 26 个数字向量 26/26 通过**（NaN/Infinity 正确拒绝）。V8 `JSON.stringify` 与 JCS 要求的 ECMAScript 数字/字符串序列化同源。**仍不声称 RFC 8785 conformant**：额外拒绝非 plain object 与不安全键（更严），且未跑完整 I-JSON 输入约束套件。跨实现复验随包附 `canonicalization-profile-v1.json` |
| Merkle | RFC 6962 | `merkle-log.mjs`：`hashJson({domain, entryHash})` 叶子、`hashJson({domain,left,right})` 父节点、power-of-two 完备子树 | **构造不等价**（无 0x00/0x01 域前缀、哈希输入为 JSON 而非裸字节）。proof 结构同为 O(log n)，但第三方不能直接套 RFC 6962 库 |
| 外部锚 | RFC 3161 TSA token | 生产为文件锚记录 + issuer 签名 checkpoint；`eip155` 链上锚为**已实现未启用**的可选模式 | 提供外部存在性证明的结构，但**均非 RFC 3161**；`external_timestamp.tsa_url/token` 字段不产生 |

**因此正确表述是「提供可映射到 AAT 证据层的独立可验证构件」，不是「AAT conformant」。**

## 4. 第三方离线复验入口

不依赖任何一方的服务器即可完成的部分：

1. 取证据包：PriorSeal `GET /v1/evidence/receipts/{receiptId}`（chain-neutral Evidence API envelope + portable verification bundle），或 `GET /v1/receipts/{receiptId}/bundle`；Issuer 公钥走 `/.well-known/priorseal-keys.json`，且**必须带外 pin**（bundle 内附的 key 只是发现元数据）。
2. 取透明度证据：`GET /v1/authorizations/{authorizationId}/transparency`；`POST /v1/receipts/verify` 为本地验签入口。
3. 本地复验（Node ≥ 20，仅 `node:crypto`）：
   - `verifyEd25519Statement`（`src/domain/ed25519.mjs`）验 checkpoint 签名；
   - `verifyTransparencyEvidence` / `verifyMerkleProof`（`transparency.mts` / `merkle-log.mjs`）验链连续性与 inclusion proof；
   - 校验文件锚记录与 checkpoint 的一致性；若证据包来自启用了 `eip155` 锚模式的部署，另用任意 RPC 独立复验 `verifyTransparencyAnchor`（含 calldata 与 block.timestamp 一致性）。**当前生产部署未启用该模式，因此常规证据包不含链上锚。**
4. Insight 侧：`POST /api/v1/safety/attestation/verify`（keyless、不收费）可离线验证 EIP-712 收据；规范化规则见 `PROVIDER_OBSERVATIONS_HASH_CANONICALIZATION`，公开描述见 `public/llms.txt`、`/openapi.json`、`/.well-known/x402.json`。
5. 已有 SCITT 侧素材：`partnerships/headless-oracle-collaboration/evidence/SCITT-Interop-Report-2026-10-12-r2.md`，以及 ERC-8004 evidence descriptor v1、x402-quality/v0 schema + 零依赖 projection tool + fixtures、A2A#1341 IN-08 已同意、OEL pin。

## 5. 已知连续性缺口（如实披露，不抹平）

一个声称提供不可篡改输入的系统，其自身日志连续性是唯一无法自证的点。以下缺口应随证据包一起公开：

- 2026-11-08：时钟断档 14 个 slot，源头即缺，永久不可回填；
- 2026-11-12：生产 DB 宕机约 10h，未自愈，经管理 API restart 恢复（restart 同时清零 `pg_stat_*`）；
- 2026-11-15：`priorseal.xyz` DNS / custom domain 记录丢失，经带外通道恢复；现有 audit log 权限不足以确定删除原因，不作归因。

披露断档比掩盖更能支撑"可独立核验"这一主张。

## 6. 最小补齐项（按依赖顺序，只列必须做的）

1. ~~规范化说明~~ **已完成（2026-11-15）**：`canonicalization-profile-v1.json` 已生成并随声明发布，含 §3.2.2 参考样例、Appendix B 26/26 实测向量、Merkle 向量、拒绝用例与离线复验配方。**结论是不需要 JCS 适配层**；剩余仅是把完整 I-JSON 输入约束验证补齐，属加固而非阻塞项。
2. **`record_phase` 显式字段**：在 checkpoint/evidence 中标明 `pre_execution`，把现有 `TRANSPARENCY_AFTER_EXECUTION` 的隐式保证变成可被引用的字段。
3. **证据包导出**：JSONL / Syslog / CSV 导出且保持链完整性（AAT transport-agnostic 要求），便于归档到审计系统。
4. **公开 checkpoint 序列**：可下载、可独立重放，并带 §5 的断档标注。
5. **公开可引用性**：本声明与规范化档案以固定 URL 发布，供任何第三方在无需联系项目方的情况下引用与复验。

## 7. 边界与风险

- `draft-sharif-agent-audit-trail-09` 是 **individual Internet-Draft**，非 IETF 背书标准；`Intended status: Standards Track` 不等于 RFC。文档自身要求只能作为 "work in progress" 引用；页眉 `Expires: April 29, 2027`，Status of This Memo 另写 2027-04-02，两处不一致。它可能过期作废。
- EU AI Act 适用日经 (EU) 2026/1744 分阶段推到 2027–2028；中国实施意见为指导性政策，等保/金融日志留存属既有要求而非新增。
- 因此本文是**用现有资产买一个低成本期权**：不新增链、不新增功能、不新增目录、不改定价。若 6–12 个月内标准线既无引用也无采购询问，按 2026-10-18「在售、不投入」定论收口。
- 推翻条件：出现按次付费**且复购**的外部买家 → 运行时需求真实，转回产品化；或 AAT 被采纳 / 出现强制审计要求 → 把资源集中到 §6 的对齐项。

## 8. 发布与更正记录

- 2026-11-15：初版生成，含一处对外表述过宽（把「已实现、已测试的 eip155 链上锚模式」写成生产已启用）。复核 `config/production.env.example`、`.env.example`、`wrangler.jsonc` 与 `docs/runbooks/operations.md` 后确认：生产锚记录为文件式，参考 Solidity 锚合约未审计、未部署，且无自有合约地址可提供。已向当日全部收件方发出更正，并在本版 §2.1 / §3 / §4 全面修正。
- 2026-11-15：规范化断言修正。原写「数字序列化与 JCS 不同」，经 RFC 8785 §3.2.2 完整样例与 Appendix B 26 个数字向量实测（26/26 通过）推翻；结论改为「已发布向量一致，但未跑完整 I-JSON 输入约束套件，且我方有更严的原型/键限制，故不声称 conformant」。
- 本版已移除内部投递状态、邮件地址与运维细节；技术内容、非主张清单与断档披露保持不变。

**本文可自由引用。引用时请保留 §0 的非主张清单与 §3 的编码差异表。**
