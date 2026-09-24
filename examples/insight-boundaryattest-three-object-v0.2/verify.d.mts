export interface ThreeObjectResult {
  code: string;
  valueConclusion: string;
  deletionTest: {
    result: string;
    unverifiableFact: string | null;
  };
  [key: string]: unknown;
}

export function verifyInsightAttestation(...args: unknown[]): Promise<Record<string, unknown>>;
export function computeInsightPairCommitment(...args: unknown[]): Record<string, unknown>;
export function verifyBoundaryAttestReceipt(...args: unknown[]): Record<string, unknown>;
export function evaluateBoundaryAttestValue(...args: unknown[]): Record<string, unknown>;
export function verifyThreeObjectFlow(
  input: Record<string, unknown>,
): Promise<ThreeObjectResult>;
export function runFixtureChecks(options?: {
  log?: (message: unknown) => void;
}): Promise<ThreeObjectResult[]>;
