export const MIN_ASSESSMENT_WINDOW_MS = 90_000
export const MAX_ASSESSMENT_WINDOW_MS = 120_000

export function hasAtLeastRemainingMs(deadlineMs: number, nowMs = Date.now(), minimumMs = MIN_ASSESSMENT_WINDOW_MS): boolean {
  return Number.isFinite(deadlineMs) && deadlineMs - nowMs >= minimumMs
}

export function isWithinAssessmentDeadlineWindow(deadlineMs: number, nowMs = Date.now()): boolean {
  const remainingMs = deadlineMs - nowMs
  return Number.isFinite(deadlineMs) && remainingMs >= MIN_ASSESSMENT_WINDOW_MS && remainingMs <= MAX_ASSESSMENT_WINDOW_MS
}

export function priceContractEndTimeMs(slug: string): number | undefined {
  const match = /^([a-z0-9]+)-updown-(\d+)m-(\d{10,})$/i.exec(slug.trim())
  if (!match) return undefined
  const windowSeconds = Number(match[2]) * 60
  const windowStartSeconds = Number(match[3])
  if (!Number.isSafeInteger(windowSeconds) || windowSeconds < 60 || !Number.isSafeInteger(windowStartSeconds)) return undefined
  const endTimeMs = (windowStartSeconds + windowSeconds) * 1_000
  return Number.isSafeInteger(endTimeMs) ? endTimeMs : undefined
}
