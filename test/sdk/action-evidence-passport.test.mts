import assert from 'node:assert/strict'
import test from 'node:test'
import { createJointReviewFixture } from '../helpers/joint-review-fixture.mjs'
import { createActionEvidencePassport, verifyActionEvidencePassport } from '../../sdk/dist/verifier.js'

test('Action Evidence Passport is a faithful wrapper around a complete native review', async () => {
  const fixture = await createJointReviewFixture()
  const passport = await createActionEvidencePassport({
    title: 'Synthetic Base swap review',
    assembledAt: 1103,
    reviewManifest: fixture.manifest,
    servicePayment: { kind: 'x402-service-payment', rawJson: '{"reference":"synthetic-service-payment"}' },
  })

  const verified = await verifyActionEvidencePassport(passport, fixture.options as Parameters<typeof verifyActionEvidencePassport>[1])
  assert.equal(verified.valid, true, JSON.stringify(verified))
  assert.equal(verified.code, 'OK')
  assert.equal(verified.servicePayment, 'UNVERIFIED_SERVICE_PAYMENT')
  assert.equal(passport.summary.txHash, fixture.manifest.expectedTxHash)
})

test('Action Evidence Passport rejects a convenience summary that no longer matches native evidence', async () => {
  const fixture = await createJointReviewFixture()
  const passport = await createActionEvidencePassport({ title: 'Synthetic Base swap review', assembledAt: 1103, reviewManifest: fixture.manifest })
  passport.summary.txHash = `0x${'f'.repeat(64)}`
  const verified = await verifyActionEvidencePassport(passport, fixture.options as Parameters<typeof verifyActionEvidencePassport>[1])
  assert.equal(verified.valid, false)
  assert.equal(verified.code, 'PASSPORT_SUMMARY_MISMATCH')
})

test('Action Evidence Passport keeps x402 service-payment bytes separate and rejects a changed attachment', async () => {
  const fixture = await createJointReviewFixture()
  const passport = await createActionEvidencePassport({
    title: 'Synthetic Base swap review', assembledAt: 1103, reviewManifest: fixture.manifest,
    servicePayment: { kind: 'x402-service-payment', rawJson: '{"reference":"service-payment-a"}' },
  })
  assert.ok(passport.servicePayment)
  passport.servicePayment.rawJson = '{"reference":"service-payment-b"}'
  const verified = await verifyActionEvidencePassport(passport, fixture.options as Parameters<typeof verifyActionEvidencePassport>[1])
  assert.equal(verified.valid, false)
  assert.equal(verified.code, 'SERVICE_PAYMENT_BYTES_MISMATCH')
  assert.equal(verified.servicePayment, 'UNVERIFIED_SERVICE_PAYMENT')
})

test('Action Evidence Passport reports an invalid embedded native review without upgrading its status', async () => {
  const fixture = await createJointReviewFixture()
  const passport = await createActionEvidencePassport({ title: 'Synthetic Base swap review', assembledAt: 1103, reviewManifest: fixture.manifest })
  passport.reviewManifest.manifestHash = '0'.repeat(64)
  const verified = await verifyActionEvidencePassport(passport, fixture.options as Parameters<typeof verifyActionEvidencePassport>[1])
  assert.equal(verified.valid, false)
  assert.equal(verified.code, 'NATIVE_REVIEW_INVALID')
  assert.equal(verified.review?.code, 'MANIFEST_HASH_MISMATCH')
})
