import pg from 'pg';
import { encodeFunctionData, isAddress } from 'viem';

const { Pool } = pg;
const contract = process.env.PRIORSEAL_ANCHOR_CONTRACT;
const chainId = Number(process.env.PRIORSEAL_ANCHOR_CHAIN_ID);
if (!isAddress(contract ?? '')) throw new TypeError('PRIORSEAL_ANCHOR_CONTRACT must be configured');
if (!Number.isSafeInteger(chainId) || chainId < 1) throw new TypeError('PRIORSEAL_ANCHOR_CHAIN_ID must be configured');
const connectionString = secureConnectionString(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);
if (!connectionString) throw new TypeError('DATABASE_URL_UNPOOLED is required');

const pool = new Pool({ connectionString });
try {
  const result = await pool.query('SELECT sequence,entry_hash FROM authorization_log ORDER BY sequence DESC LIMIT 1');
  const row = result.rows[0];
  if (!row) throw new TypeError('The authorization log is empty');
  const size = Number(row.sequence);
  const headEntryHash = String(row.entry_hash);
  const data = encodeFunctionData({ abi: anchorAbi(), functionName: 'anchor', args: [BigInt(size), `0x${headEntryHash}`] });
  console.log(JSON.stringify({ chainId, to: contract.toLowerCase(), value: '0x0', data, checkpoint: { size, headEntryHash } }, null, 2));
} finally {
  await pool.end();
}

function anchorAbi() { return [{ type: 'function', name: 'anchor', stateMutability: 'nonpayable', inputs: [{ name: 'size', type: 'uint256' }, { name: 'head', type: 'bytes32' }], outputs: [] }]; }
function secureConnectionString(value) { if (!value) return value; const url = new URL(value); if (['prefer', 'require', 'verify-ca'].includes(url.searchParams.get('sslmode'))) url.searchParams.set('sslmode', 'verify-full'); return url.toString(); }
