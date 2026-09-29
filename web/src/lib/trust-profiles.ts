import { getStoragePreference } from './storage'
import { parseTrustProfile as parseSdkTrustProfile, type TrustProfile as SdkTrustProfile } from 'priorseal-sdk/verifier'

export type TrustProfile = SdkTrustProfile & { name: string }
const storageKey = 'priorseal.trust-profiles.v1'
let memory: TrustProfile[] = []
window.addEventListener('priorseal:trust-clear', () => { memory = [] })

export function parseTrustProfile(value: unknown): TrustProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Import a trust profile JSON object.')
  const input = value as Record<string, unknown>
  // The console accepts drafts. The SDK format uses zero to represent an
  // unconfirmed draft; only an explicit confirmation may enter saved trust.
  const profile = parseSdkTrustProfile({ ...input, confirmedAt: input.confirmedAt ?? 0 })
  return { ...profile, name: profile.name?.trim() || profile.issuer }
}

export function isConfirmedTrustProfile(profile: TrustProfile): boolean {
  return Number.isSafeInteger(profile.confirmedAt) && profile.confirmedAt > 0
}

export function getTrustProfiles(): TrustProfile[] {
  if (getStoragePreference() !== 'granted') return memory
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
    if (!Array.isArray(value)) return []
    return value.flatMap((entry: unknown) => {
      try {
        const profile = parseTrustProfile(entry)
        return isConfirmedTrustProfile(profile) ? [profile] : []
      } catch { return [] }
    }).slice(0, 20)
  } catch { return [] }
}

export function saveTrustProfile(profile: TrustProfile) {
  const value = parseTrustProfile(profile)
  if (!isConfirmedTrustProfile(value)) throw new TypeError('Confirm the trust profile before saving it.')
  const profiles = [value, ...getTrustProfiles().filter((entry) => entry.name !== value.name)].slice(0, 20)
  memory = profiles
  if (getStoragePreference() === 'granted') { try { localStorage.setItem(storageKey, JSON.stringify(profiles)) } catch { /* Optional browser saving must not block verification. */ } }
}

export async function keyFingerprint(publicKey: string) {
  const pem = publicKey.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, '')
  const bytes = Uint8Array.from(atob(pem), (character) => character.charCodeAt(0))
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (value) => value.toString(16).padStart(2, '0')).join('')
}
