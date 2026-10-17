import pg from 'pg';
import { loadRuntimeConfig } from '../src/bootstrap/runtime-config.mjs';
import { buildX402PaymentRefundLedgerEvent } from '../src/domain/x402-payment-ledger.mjs';
import { createPostgresStore } from '../src/infrastructure/persistence/postgres-store.mjs';

if (!['staging', 'production'].includes(process.env.PRIORSEAL_ENVIRONMENT ?? '')) throw new TypeError('Set PRIORSEAL_ENVIRONMENT=staging or production before recording a verified refund');
const argumentsByName = parseArguments(process.argv.slice(2));
const config = loadRuntimeConfig();
if (!config.databaseDirectUrl || config.databaseBackend === 'd1') throw new TypeError('The refund recorder requires a PostgreSQL DATABASE_URL_UNPOOLED; use the restricted D1 operator channel for a D1 deployment');
const event = buildX402PaymentRefundLedgerEvent({
  ledgerId: required(argumentsByName, 'ledger-id'),
  network: required(argumentsByName, 'network'),
  transaction: required(argumentsByName, 'transaction'),
  amount: required(argumentsByName, 'amount'),
  reasonCode: required(argumentsByName, 'reason-code'),
  occurredAt: argumentsByName['occurred-at'] === undefined ? Date.now() : epochMilliseconds(argumentsByName['occurred-at']),
});

const pool = new pg.Pool({ connectionString: config.databaseDirectUrl });
try {
  await createPostgresStore(pool).appendX402PaymentLedgerEvent(event);
} finally {
  await pool.end();
}
console.log(JSON.stringify({ recorded: true, ledgerId: event.ledgerId, eventId: event.eventId, type: event.type, network: event.refund?.network, transaction: event.refund?.transaction }));

function parseArguments(values: string[]) {
  if (values.length % 2) throw new TypeError('Arguments must be --name value pairs');
  const parsed: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index]; const value = values[index + 1];
    if (!/^--(?:ledger-id|network|transaction|amount|reason-code|occurred-at)$/.test(name) || !value || parsed[name.slice(2)] !== undefined) throw new TypeError('Use each supported refund argument once: --ledger-id --network --transaction --amount --reason-code [--occurred-at]');
    parsed[name.slice(2)] = value;
  }
  return parsed;
}

function required(values: Record<string, string>, name: string) {
  const value = values[name];
  if (!value) throw new TypeError(`Missing --${name}`);
  return value;
}

function epochMilliseconds(value: string) {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw new TypeError('--occurred-at must be a positive epoch-millisecond integer');
  return Number(value);
}
