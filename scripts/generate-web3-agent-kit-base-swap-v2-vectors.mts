import { generateWeb3AgentKitBaseSwapVectors } from './web3-agent-kit-base-swap-generator.mjs';

await generateWeb3AgentKitBaseSwapVectors({
  outputPath: '../examples/web3-agent-kit-base-swap-v2/',
  insightCommit: '840b376525d340672f4a0b18d1fd1723a74768da',
  priorSealCommit: '56d05c783f8ce0b9e040f6ef6d9f87b2ac04367e',
  policySchema: 'web3-agent-kit.insight-composition-policy.v2',
  policyId: 'wak-base-swap-insight-composition-v2',
  passWithoutNativeConfirmation: 'PROCEED_TO_PRINCIPAL_AUTHORIZATION',
  decisionSchema: 'web3-agent-kit.policy-decision-evidence.v2',
  evidenceSchema: 'web3-agent-kit.base-swap-evidence.v2',
  trustRootsSchema: 'web3-agent-kit.base-swap-trust-roots.v2',
});
