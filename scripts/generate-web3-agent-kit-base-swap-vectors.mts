import { generateWeb3AgentKitBaseSwapVectors } from './web3-agent-kit-base-swap-generator.mjs';

await generateWeb3AgentKitBaseSwapVectors({
  outputPath: '../examples/web3-agent-kit-base-swap-v1/',
  insightCommit: '7b3311c5fcce064e8a0411fcefe32143cb4530ea',
  priorSealCommit: '506c59c121b962bdfc06df37023559f71e3fd8e8',
  policySchema: 'web3-agent-kit.insight-composition-policy.v1',
  policyId: 'wak-base-swap-insight-composition-v1',
  passWithoutNativeConfirmation: 'ALLOW_EXECUTION',
  decisionSchema: 'web3-agent-kit.policy-decision-evidence.v1',
  evidenceSchema: 'web3-agent-kit.base-swap-evidence.v1',
  trustRootsSchema: 'web3-agent-kit.base-swap-trust-roots.v1',
});
