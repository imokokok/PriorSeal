export interface FixtureResult {
  name: string;
  code: string;
  [key: string]: unknown;
}

export function verifyThoughtProofExport(...args: unknown[]): FixtureResult;
export function verifyPair(input: Record<string, unknown>): Promise<FixtureResult>;
export function runFixtureChecks(options?: {
  log?: (message: unknown) => void;
}): Promise<FixtureResult[]>;
