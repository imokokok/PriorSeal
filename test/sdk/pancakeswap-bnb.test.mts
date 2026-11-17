import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertPancakeSwapBnbApprovalSpender,
  assertPancakeSwapBnbExactInputCall,
  PANCAKESWAP_BNB_SMART_ROUTER,
  PANCAKESWAP_BNB_SMART_ROUTER_PROFILE,
  PANCAKESWAP_BNB_V2_PROFILE,
  PANCAKESWAP_BNB_V2_ROUTER,
} from '../../sdk/dist/index.js'

const sender = `0x${'11'.repeat(20)}`

test('admits an exact-input PancakeSwap V2 call only at the reviewed BNB router', () => {
  const data = '0x38ed173900000000' // selector + opaque, already-final calldata fixture
  assert.equal(assertPancakeSwapBnbExactInputCall({ chainId: 56, from: sender, to: PANCAKESWAP_BNB_V2_ROUTER, data, value: '0' }, PANCAKESWAP_BNB_V2_PROFILE), PANCAKESWAP_BNB_V2_PROFILE)
  assert.doesNotThrow(() => assertPancakeSwapBnbApprovalSpender(PANCAKESWAP_BNB_V2_ROUTER, PANCAKESWAP_BNB_V2_PROFILE))
})

test('admits SmartRouter exact-input selectors but rejects native-value calls', () => {
  const data = '0xb858183fdeadbeef'
  assert.equal(assertPancakeSwapBnbExactInputCall({ chainId: 56, from: sender, to: PANCAKESWAP_BNB_SMART_ROUTER, data, value: '0' }, PANCAKESWAP_BNB_SMART_ROUTER_PROFILE), PANCAKESWAP_BNB_SMART_ROUTER_PROFILE)
  assert.throws(() => assertPancakeSwapBnbExactInputCall({ chainId: 56, from: sender, to: PANCAKESWAP_BNB_SMART_ROUTER, data, value: '1' }, PANCAKESWAP_BNB_SMART_ROUTER_PROFILE), /native-value/)
})

