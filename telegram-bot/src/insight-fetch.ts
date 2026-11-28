const INSIGHT_ORIGIN = 'https://www.oracleinsight.xyz'

export type InsightServiceBinding = Pick<Fetcher, 'fetch'>

/** Route first-party Insight calls through the private Worker service binding. */
export function createInsightFetcher(
  service: InsightServiceBinding | undefined,
  fallback: typeof fetch = fetch,
): typeof fetch {
  return (input, init) => {
    const rawUrl = input instanceof Request ? input.url : input.toString()
    let url: URL
    try {
      url = new URL(rawUrl)
    } catch {
      return fallback(input, init)
    }

    if (service && url.origin === INSIGHT_ORIGIN) {
      return service.fetch(input, init)
    }
    return fallback(input, init)
  }
}
