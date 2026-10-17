#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { verifyVerificationBundleLocally } from '../sdk/dist/verifier.js'

type RecordValue = Record<string, unknown>

function requireRecord(value: unknown, label: string): asserts value is RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`)
}

function requireString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string`)
}

function readJson(path: string) {
  return readFile(resolve(path), 'utf8').then((text) => JSON.parse(text) as unknown)
}

function validateTrustRoot(value: unknown) {
  requireRecord(value, 'trust root')
  if (value.schema !== 'priorseal.pilot-trust-root.v1') throw new TypeError('Unsupported trust root schema')
  requireString(value.audience, 'trust root audience')
  if (value.testOnly !== true) throw new TypeError('This verifier only accepts the explicit local-test trust root')
  requireRecord(value.key, 'trust root key')
  const key = value.key
  requireString(key.issuer, 'trust root key issuer')
  requireString(key.keyId, 'trust root key ID')
  requireString(key.algorithm, 'trust root key algorithm')
  requireString(key.publicKey, 'trust root public key')
  if (key.status !== 'active') throw new TypeError('Trust root key must be active')
  if (key.validFrom !== null || key.validUntil !== null) throw new TypeError('Local pilot trust root must not contain a key validity window')
  return {
    audience: value.audience,
    key: {
      issuer: key.issuer,
      keyId: key.keyId,
      algorithm: key.algorithm,
      publicKey: key.publicKey,
      status: key.status,
      validFrom: null,
      validUntil: null,
    },
  }
}

function verifyPilotScope(bundle: unknown) {
  try {
    requireRecord(bundle, 'evidence pack')
    requireRecord(bundle.receipt, 'evidence pack receipt')
    const receipt = bundle.receipt
    if (receipt.schema !== 'priorseal.execution-receipt.v3') return 'UNSUPPORTED_RECEIPT_SCHEMA'
    if (receipt.executionStatus !== 'CONFIRMED') return 'EXECUTION_NOT_CONFIRMED'
    requireRecord(receipt.compliance, 'evidence pack compliance')
    if (receipt.compliance.status !== 'COMPLIANT') return 'EXECUTION_NOT_COMPLIANT'
    requireRecord(receipt.authorizationEvidence, 'authorization evidence')
    requireRecord(receipt.authorizationEvidence.authorization, 'authorization')
    requireRecord(receipt.authorizationEvidence.authorization.intent, 'authorization intent')
    const intent = receipt.authorizationEvidence.authorization.intent
    if (intent.executionProfile !== 'priorseal.execution-profile.exact-call.v1') return 'UNSUPPORTED_EXECUTION_PROFILE'
    if (intent.action !== 'CONTRACT_CALL') return 'UNSUPPORTED_ACTION'
    return 'OK'
  } catch {
    return 'INVALID_PILOT_SCOPE'
  }
}

const [evidencePackPath, trustRootPath] = process.argv.slice(2)
if (!evidencePackPath || !trustRootPath || process.argv.length !== 4) {
  throw new Error('Usage: node scripts/verify-restricted-automation-pilot.mjs <evidence-pack.json> <trust-root.json>')
}

const [bundle, trustRootValue] = await Promise.all([readJson(evidencePackPath), readJson(trustRootPath)])
const trustRoot = validateTrustRoot(trustRootValue)
const local = await verifyVerificationBundleLocally(bundle, { trustedKeys: trustRoot.key, expectedAudience: trustRoot.audience })
const scope = verifyPilotScope(bundle)
const valid = local.valid && scope === 'OK'
process.stdout.write(`${JSON.stringify({
  schema: 'priorseal.restricted-automation-pilot-verification.v1',
  valid,
  scope,
  localVerification: local,
  trust: {
    source: 'explicitly supplied trust-root.json',
    audience: trustRoot.audience,
    issuer: trustRoot.key.issuer,
    keyId: trustRoot.key.keyId,
    testOnly: true,
  },
}, null, 2)}\n`)

if (!valid) process.exitCode = 1
