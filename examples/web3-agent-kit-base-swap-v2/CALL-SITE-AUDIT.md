# Web3 Agent Kit pre-sign call-site audit

- Reviewed repository: `https://github.com/ulsreall/web3-agent-kit`
- Reviewed commit: `b673b82e4e90dfc86942fd59533a6b3e5f32598c`
- Method: Python AST enumeration of production call expressions whose called attribute is `sign_transaction`
- Result: 24 production call expressions, plus the `Wallet.sign_transaction` definition at `web3_agent_kit/wallet/wallet.py:133`, for 25 signer-related positions
- Tests excluded from the production count: 3 additional call expressions

## Production inventory

| Area | File | Lines | Count | Existing path |
|---|---|---:|---:|---|
| Airdrop | `web3_agent_kit/airdrop/onchain.py` | 776 | 1 | direct `self._account` signer |
| Bridge | `web3_agent_kit/bridge/bridge.py` | 396, 452 | 2 | Wallet wrapper |
| DeFi | `web3_agent_kit/defi/__init__.py` | 333, 438, 692, 1015, 1243, 1555 | 6 | Wallet wrapper |
| DeFi / Uniswap v3 | `web3_agent_kit/defi/uniswap_v3.py` | 603, 770 | 2 | Wallet wrapper |
| Governance | `web3_agent_kit/governance/__init__.py` | 431 | 1 | direct `w3.eth.account` signer |
| Messaging | `web3_agent_kit/messaging/__init__.py` | 278 | 1 | direct `w3.eth.account` signer |
| Restaking / EigenLayer | `web3_agent_kit/plugins/restaking/eigenlayer.py` | 317, 367, 405, 450, 719 | 5 | Wallet wrapper |
| Restaking / protocols | `web3_agent_kit/plugins/restaking/protocols.py` | 281, 324, 452, 496 | 4 | Wallet wrapper |
| Wallet implementation | `web3_agent_kit/wallet/wallet.py` | 141, 150 | 2 | underlying Account signer; `send_transaction()` calling Wallet signer |

The 19 module calls through the Wallet wrapper plus 3 direct module signers and 2 calls inside the Wallet implementation total 24 production call expressions.

## Integration consequence

Adding a callback only to `Wallet.sign_transaction()` would cover the Wallet-mediated paths but not the direct airdrop, messaging and governance signers. The generic interceptor should therefore be expressed as the only approved signing API, migrate those three direct paths, and be protected by a static regression test that fails on any unapproved direct `sign_transaction` call.

This is source review evidence, not a claim that Web3 Agent Kit has adopted or merged the design.
