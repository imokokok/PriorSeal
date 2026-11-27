export function withPerpAssessmentExpiry<T extends { order: { expiresAfter?: number } }>(request: T, nowMs = Date.now()) {
  return { ...request, order: { ...request.order, expiresAfter: nowMs + 110_000 } }
}

export function withSwapAssessmentDeadline<T extends { guard: { deadlineUnixSeconds?: number } }>(request: T, nowMs = Date.now()) {
  return { ...request, guard: { ...request.guard, deadlineUnixSeconds: Math.floor(nowMs / 1_000) + 110 } }
}
