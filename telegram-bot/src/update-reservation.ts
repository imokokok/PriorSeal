export type ExistingUpdateReservation = { createdAt: number; completed: number } | null
export type UpdateReservationDecision = 'duplicate' | 'in_progress' | 'retry'

export const TELEGRAM_UPDATE_LEASE_SECONDS = 120

export function decideUpdateReservation(
  prior: ExistingUpdateReservation,
  now: number,
): UpdateReservationDecision {
  if (!prior) return 'retry'
  if (prior.completed === 1) return 'duplicate'
  if (now - prior.createdAt < TELEGRAM_UPDATE_LEASE_SECONDS) return 'in_progress'
  return 'retry'
}
