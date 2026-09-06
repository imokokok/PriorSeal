import type { AuthorizationRecord, Execution, Intent, Receipt } from 'priorseal-sdk'

export type * from 'priorseal-sdk'
export type { PriorSealApiError as ApiError } from 'priorseal-sdk'

export type ChainName = 'Ethereum' | 'Base' | 'Arbitrum'
export type LocalActivity = { intents: Intent[]; authorizations: AuthorizationRecord[]; receipts: Receipt[]; observations: Execution[] }
