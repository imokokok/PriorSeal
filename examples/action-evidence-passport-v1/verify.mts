#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { verifyActionEvidencePassport, type ActionEvidencePassport } from './passport.mjs'

function argument(name: string): string {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1] : undefined
  if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`)
  return value
}

const passport = JSON.parse(await readFile(argument('--passport'), 'utf8')) as ActionEvidencePassport
const trust = JSON.parse(await readFile(argument('--trust'), 'utf8'))
const result = await verifyActionEvidencePassport(passport, trust)
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
if (!result.valid) process.exitCode = 1
