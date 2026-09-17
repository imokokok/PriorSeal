# Test record

- Date: 2026-09-17
- Network: Base Sepolia (`84532`)
- Mode: live testnet execution, nonproduction evidence
- Flow: build complete transaction → quote/simulate → principal exact-call authorization → sign → broadcast → observe → signed PriorSeal receipt → offline and online verification
- Insight boundary: no live C3/C4 request; chain quote only, explicitly non-attested

## Result

- Broadcast result: `PASS`
- Transaction: `0xbc290cc158ae99d67d1ef359c730ec798bb3348c8cc1e349f8fd52234ef0e246`
- Explorer: `https://sepolia.basescan.org/tx/0xbc290cc158ae99d67d1ef359c730ec798bb3348c8cc1e349f8fd52234ef0e246`
- Block: `46946167`
- Nonce: `265`
- Input: `1000000000000` wei
- Quoted / received output: `4144` / `4144` USDC base units
- Minimum output: `3936` USDC base units
- Gas used: `130799`
- Fee paid: `784794000000` wei
- Authorization: `auth_33fb6985513aec043995288402ba6514`
- Receipt: `psr_ce3053e439f2bb73942144b3f2960197`
- Exact-call binding: `true`
- Compliance: `COMPLIANT`
- Offline verification: `PASS` with no failures
- Online RPC verification: `PASS` with no failures

Authorization was issued and accepted at Unix time `1789660620`; the block timestamp was `1789660622`. The online verifier independently matched sender, router, nonce, value, calldata hash, success status and block number.
