export interface FixtureResult {
  name: string;
  code: string;
  [key: string]: unknown;
}

export function verifyThoughtProofExport(...args: unknown[]): FixtureResult;
export function verifyExactCallDecisionSubject(...args: unknown[]): FixtureResult;
export function verifyM2Pair(input: Record<string, unknown>): Promise<FixtureResult>;
export function verifyCalldataFixtures(fixtures: unknown): FixtureResult[];
export function verifySubjectFixtures(fixtures: unknown, expected: unknown): FixtureResult[];
export function runFixtureChecks(options?: {
  log?: (message: unknown) => void;
}): Promise<FixtureResult[]>;
