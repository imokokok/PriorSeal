export interface FinalPairResult {
  code: string;
  subjectBindingCode?: string;
  [key: string]: unknown;
}

export function runFinalPairChecks(options?: {
  log?: (message: unknown) => void;
}): Promise<FinalPairResult[]>;
