import assert from 'node:assert/strict'
import test from 'node:test'
import { decideUpdateReservation, TELEGRAM_UPDATE_LEASE_SECONDS } from '../src/update-reservation.ts'

test('completed Telegram updates are acknowledged as duplicates', () => {
  assert.equal(decideUpdateReservation({ createdAt: 100, completed: 1 }, 101), 'duplicate')
})

test('recent incomplete updates remain retryable instead of being dropped', () => {
  assert.equal(decideUpdateReservation({ createdAt: 100, completed: 0 }, 101), 'in_progress')
  assert.equal(decideUpdateReservation({ createdAt: 100, completed: 0 }, 100 + TELEGRAM_UPDATE_LEASE_SECONDS - 1), 'in_progress')
})

test('stale incomplete updates can be reserved again', () => {
  assert.equal(decideUpdateReservation({ createdAt: 100, completed: 0 }, 100 + TELEGRAM_UPDATE_LEASE_SECONDS), 'retry')
  assert.equal(decideUpdateReservation(null, 100), 'retry')
})
