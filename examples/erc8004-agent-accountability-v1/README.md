# ERC-8004 agent accountability inspection

This read-only CLI resolves an ERC-8004 agent reference on the configured EVM chain, checks that the registry is explicitly allowlisted, compares the agent's registered `agentWallet` with the expected executor, and exports a block-pinned identity snapshot plus its PriorSeal context commitment.

The command never requests a wallet, signs a message, submits a transaction, or prints the RPC URL. Use an RPC endpoint and registry address you trust. For stronger pinning, configure the registry runtime code hash too.

```bash
ERC8004_RPC_URL='https://your-read-only-rpc.example' \
ERC8004_AGENT_REF='erc8004:eip155:84532:0x1111111111111111111111111111111111111111:42' \
ERC8004_EXECUTOR='0x3333333333333333333333333333333333333333' \
ERC8004_TRUSTED_IDENTITY_REGISTRIES='0x1111111111111111111111111111111111111111' \
npm run example:erc8004-inspect
```

Optional `ERC8004_TRUSTED_REGISTRY_CODE_HASHES` accepts a comma-separated list of expected runtime code hashes. The CLI returns exit code `2` if the registry state cannot be verified or the registered wallet does not match the executor. It does not fetch the registration `tokenURI`; that URI is external, untrusted input.

The returned commitment can be included in `intent.contextCommitments` for a supported `priorseal.intent.v2` exact-call or ERC-4337 profile, while the canonical agent reference goes in `delegate.agentId`. A reviewer should independently verify the PriorSeal receipt and then call `verifyERC8004AuthorizationBinding` with an RPC capable of reading the historical snapshot block.
