const REGISTRATION_URL = 'https://priorseal.xyz/.well-known/sati-agent.json'
const SATI_API = 'https://sati.cascade.fyi'

type JsonRecord = Record<string, unknown>

function arg(name: string) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function demand(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function record(value: unknown, label: string): JsonRecord {
  demand(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`)
  return value as JsonRecord
}

async function json(url: string) {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  const text = await response.text()
  let body: unknown
  try { body = JSON.parse(text) } catch { body = text }
  return { response, body }
}

function isRateLimited(result: Awaited<ReturnType<typeof json>>) {
  const serialized = JSON.stringify(result.body)
  return result.response.status === 429 || serialized.includes('Too Many Requests') || serialized.includes('statusCode=429') || serialized.includes('statusCode%3D429')
}

async function main() {
  const mint = arg('--mint')
  const registrationUrl = arg('--registration') ?? REGISTRATION_URL
  const registrationResponse = await json(registrationUrl)
  demand(registrationResponse.response.ok, `registration request failed with HTTP ${registrationResponse.response.status}`)
  const registration = record(registrationResponse.body, 'registration')
  demand(registration.type === 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1', 'registration type is not ERC-8004 registration-v1')
  demand(registration.name === 'PriorSeal', 'registration name is not PriorSeal')
  demand(registration.active === true, 'registration is not active')
  demand(registration.x402Support === true, 'registration does not declare x402 support')
  demand(Array.isArray(registration.supportedTrust) && registration.supportedTrust.includes('reputation'), 'registration does not declare reputation trust')
  const services = Array.isArray(registration.services) ? registration.services : []
  const serviceNames = services.map((service) => record(service, 'service').name)
  demand(serviceNames.includes('MCP'), 'registration is missing the MCP service')
  demand(serviceNames.includes('OpenAPI'), 'registration is missing the OpenAPI service')
  console.log(JSON.stringify({ status: 'REGISTRATION_OK', registrationUrl, services: serviceNames }, null, 2))

  const searchUrl = new URL('/api/agents', SATI_API)
  searchUrl.searchParams.set('network', 'mainnet')
  searchUrl.searchParams.set('limit', '50')
  searchUrl.searchParams.set('name', 'PriorSeal')
  const search = await json(searchUrl.toString())
  if (isRateLimited(search)) {
    console.log(JSON.stringify({ status: 'SATI_QUERY_RATE_LIMITED', httpStatus: 429, retryAfter: search.response.headers.get('retry-after') }, null, 2))
    return
  }
  demand(search.response.ok, `SATI agent search failed with HTTP ${search.response.status}`)
  const searchBody = record(search.body, 'SATI search response')
  const agents = Array.isArray(searchBody.agents) ? searchBody.agents : []
  const matches = agents.filter((agent) => record(agent, 'SATI agent').name === 'PriorSeal')
  if (!mint) {
    console.log(JSON.stringify({ status: matches.length ? 'SATI_IDENTITY_FOUND' : 'SATI_IDENTITY_NOT_FOUND', matches }, null, 2))
    return
  }

  const agentUrl = new URL(`/api/agents/${encodeURIComponent(mint)}`, SATI_API)
  agentUrl.searchParams.set('network', 'mainnet')
  const agent = await json(agentUrl.toString())
  if (isRateLimited(agent)) {
    console.log(JSON.stringify({ status: 'SATI_QUERY_RATE_LIMITED', mint, httpStatus: 429, retryAfter: agent.response.headers.get('retry-after') }, null, 2))
    return
  }
  demand(agent.response.ok, `SATI agent lookup failed with HTTP ${agent.response.status}`)
  const agentBody = record(agent.body, 'SATI agent response')
  demand(agentBody.mint === mint, 'SATI response mint does not match the requested mint')
  const reputationUrl = new URL(`/api/reputation/${encodeURIComponent(mint)}`, SATI_API)
  reputationUrl.searchParams.set('network', 'mainnet')
  const reputation = await json(reputationUrl.toString())
  if (isRateLimited(reputation)) {
    console.log(JSON.stringify({ status: 'SATI_IDENTITY_FOUND_REPUTATION_RATE_LIMITED', mint, httpStatus: 429 }, null, 2))
    return
  }
  demand(reputation.response.ok, `SATI reputation lookup failed with HTTP ${reputation.response.status}`)
  console.log(JSON.stringify({ status: 'SATI_IDENTITY_AND_REPUTATION_OK', mint, agent: agentBody, reputation: reputation.body }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
