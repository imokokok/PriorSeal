export interface FixtureCheckResult {
  name: string;
  code: string;
  [key: string]: unknown;
}

export function verifyBoundaryAttestReceipt(
  receipt: unknown,
  publicKeyPem: string,
): Record<string, unknown>;
export function verifyPair(input: Record<string, unknown>): Promise<Record<string, unknown>>;
export function runFixtureChecks(options?: {
  log?: (message: unknown) => void;
}): Promise<FixtureCheckResult[]>;
