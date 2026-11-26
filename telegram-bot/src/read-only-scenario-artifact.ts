export type ReadOnlyScenario = 'hyperliquid-perp' | 'dex-swap'

/** Return only signed assessment data; never attach execution intents to a Telegram artifact. */
export function createReadOnlyScenarioArtifact(
  scenario: ReadOnlyScenario,
  insightDecision: Record<string, unknown>,
): Record<string, unknown> {
  return { scenario, insightDecision, transactionAuthority: 'none' }
}
