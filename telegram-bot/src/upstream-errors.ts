export type UpstreamErrorService = 'INSIGHT' | 'INSIGHT_MCP' | 'KEY_REGISTRY'

export class UpstreamHttpError extends Error {
  readonly service: UpstreamErrorService
  readonly status: number
  readonly retryAfterSeconds?: number

  constructor(
    service: UpstreamErrorService,
    status: number,
    retryAfterSeconds?: number,
  ) {
    super(`${service}_HTTP_${status}`)
    this.name = 'UpstreamHttpError'
    this.service = service
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

function retryAfterSeconds(response: Response): number | undefined {
  const value = response.headers.get('retry-after')?.trim()
  if (!value) return undefined

  if (/^\d{1,6}$/.test(value)) {
    const seconds = Number(value)
    return seconds > 0 ? Math.min(seconds, 86_400) : undefined
  }

  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return undefined
  const seconds = Math.ceil((timestamp - Date.now()) / 1_000)
  return seconds > 0 ? Math.min(seconds, 86_400) : undefined
}

export function upstreamHttpError(
  response: Response,
  service: UpstreamErrorService = 'INSIGHT',
): UpstreamHttpError {
  return new UpstreamHttpError(service, response.status, retryAfterSeconds(response))
}

export function upstreamAssessmentFailure(error: unknown, fallback: string): string {
  if (!(error instanceof UpstreamHttpError)) return fallback

  if (error.status === 402) {
    return 'Insight did not issue an assessment because this API key needs available credits or payment access. Ask the bot operator to check the Insight API key plan and balance.'
  }
  if (error.status === 429) {
    const retry = error.retryAfterSeconds
    return retry
      ? `Insight API rate limit reached. Retry in about ${retry} seconds. No assessment was produced.`
      : 'Insight API rate limit reached. Wait for the limit to reset before retrying. No assessment was produced.'
  }
  if (error.status === 401 || error.status === 403) {
    return 'Insight rejected the bot API credentials. Ask the bot operator to verify the configured API key. No assessment was produced.'
  }
  if (error.status >= 500) {
    return 'Insight assessment service is temporarily unavailable. No assessment was produced; please retry later.'
  }
  return fallback
}
