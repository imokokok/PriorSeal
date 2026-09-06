import { createPriorSealClient } from 'priorseal-sdk'

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

export const api = createPriorSealClient({ baseUrl: BASE_URL, timeoutMs: 15_000 })
