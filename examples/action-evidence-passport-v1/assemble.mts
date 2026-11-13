#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import { createActionEvidencePassport } from './passport.mjs'

function argument(name: string): string {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1] : undefined
  if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`)
  return value
}

const manifestPath = argument('--manifest')
const outputPath = argument('--out')
const title = argument('--title')
const paymentIndex = process.argv.indexOf('--service-payment')
const paymentPath = paymentIndex >= 0 ? process.argv[paymentIndex + 1] : undefined
if (paymentIndex >= 0 && (!paymentPath || paymentPath.startsWith('--'))) throw new Error('Missing --service-payment value')

const reviewManifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const servicePayment = paymentPath === undefined
  ? undefined
  : { kind: 'x402-service-payment' as const, rawJson: await readFile(paymentPath, 'utf8') }
const passport = await createActionEvidencePassport({
  title,
  assembledAt: Math.floor(Date.now() / 1000),
  reviewManifest,
  servicePayment,
})
await writeFile(outputPath, `${JSON.stringify(passport, null, 2)}\n`)
