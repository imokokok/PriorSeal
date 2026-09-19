import { getStoragePreference } from './storage'
import { parseTrustProfile as parseSdkTrustProfile, type TrustProfile as SdkTrustProfile } from 'priorseal-sdk/verifier'

export type TrustProfile = SdkTrustProfile & { name: string }
const storageKey = 'priorseal.trust-profiles.v1'
let memory: TrustProfile[] = []
window.addEventListener('priorseal:trust-clear', () => { memory = [] })

export function parseTrustProfile(value: unknown): TrustProfile {
  if (!value || typeof value !== 'object') throw new Error('Import a trust profile JSON object.')
  const input = value as Partial<SdkTrustProfile>
  const profile = parseSdkTrustProfile({ ...input, confirmedAt: input.confirmedAt ?? 0 })
  return { ...profile, name: profile.name?.trim() || profile.issuer }
}

export function getTrustProfiles(): TrustProfile[] {
  if (getStoragePreference() !== 'granted') return memory
  try { const value = JSON.parse(localStorage.getItem(storageKey) ?? '[]'); return Array.isArray(value) ? value.map(parseTrustProfile) : [] } catch { return [] }
}

export function saveTrustProfile(profile: TrustProfile) {
  const value = parseTrustProfile(profile)
  const profiles = [value, ...getTrustProfiles().filter((entry) => entry.name !== value.name)].slice(0, 20)
  memory = profiles
  if (getStoragePreference() === 'granted') { try { localStorage.setItem(storageKey, JSON.stringify(profiles)) } catch { /* Optional browser saving must not block verification. */ } }
}

export async function keyFingerprint(publicKey: string) {
  const pem = publicKey.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, '')
  const bytes = Uint8Array.from(atob(pem), (character) => character.charCodeAt(0))
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (value) => value.toString(16).padStart(2, '0')).join('')
}
