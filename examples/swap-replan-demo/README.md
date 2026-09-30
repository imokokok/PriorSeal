# Swap replan demonstration

Run from the repository root:

```sh
npm run example:swap-replan
```

This offline demonstration builds one synthetic, reviewed ERC-20 swap and shows that changing the recipient, input amount, minimum output or pool fee changes the signed call. The original authorization guard rejects each proposal. It then builds a fresh intent for one changed proposal, which would require a new principal signature and PriorSeal acceptance in a real workflow. It uses a generated local account and does not connect to an RPC endpoint or broadcast.

The comparison helper explains differences for reviewers. It does not authorize execution. Production signing paths must use the guarded DeFi gateway and check accepted authorization, router code and the actual signed transaction immediately before broadcast. See [reviewed swap authorization](../../docs/product/swap-authorization.md) and [the DeFi gateway](../../docs/product/defi-execution-gateway.md).
