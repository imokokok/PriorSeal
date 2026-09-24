export interface BaseSwapFixtureResult {
  status: string;
  cases: Array<{ actual: string; [key: string]: unknown }>;
  report: {
    authority: Record<string, unknown>;
    authorization: Record<string, unknown>;
    timing: Record<string, unknown>;
    compliance: Record<string, unknown>;
    historicalVerification: Record<string, unknown>;
  };
}

export function verifyEvidenceBundle(
  bundle: unknown,
  roots: unknown,
): Promise<Record<string, unknown>>;
export function runFixtureChecks(): Promise<BaseSwapFixtureResult>;
