import {
  encodeFunctionData,
  hashTypedData,
  parseAbi,
  recoverTypedDataAddress,
  zeroAddress,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem'
import {
  entryPoint07Abi,
  toPackedUserOperation,
  toSmartAccount,
  type UserOperation,
} from 'viem/account-abstraction'
import { PILOT_CHAIN_ID, PILOT_ENTRY_POINT } from './erc4337-profile.ts'

const META_MASK_EOA_STUB_SIGNATURE = '0x000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000011b' as const
const delegationAbi = parseAbi([
  'function execute((address target,uint256 value,bytes callData) execution) payable',
  'function getPackedUserOperationTypedDataHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)',
])

const signablePackedUserOperationTypes = {
  PackedUserOperation: [
    { name: 'sender', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'initCode', type: 'bytes' },
    { name: 'callData', type: 'bytes' },
    { name: 'accountGasLimits', type: 'bytes32' },
    { name: 'preVerificationGas', type: 'uint256' },
    { name: 'gasFees', type: 'bytes32' },
    { name: 'paymasterAndData', type: 'bytes' },
    { name: 'entryPoint', type: 'address' },
  ],
} as const

export function encodeMetaMask7702PilotCall(target: `0x${string}` = zeroAddress): Hex {
  return encodeFunctionData({
    abi: delegationAbi,
    functionName: 'execute',
    args: [{ target, value: 0n, callData: '0x' }],
  })
}

export async function createMetaMask7702PilotAccount(input: {
  client: PublicClient
  walletClient: WalletClient
  address: `0x${string}`
}) {
  if (input.client.chain?.id !== PILOT_CHAIN_ID) throw new TypeError('MetaMask 7702 pilot client must use Base Sepolia')
  if (input.walletClient.chain?.id !== PILOT_CHAIN_ID) throw new TypeError('MetaMask wallet must be connected to Base Sepolia')

  return toSmartAccount({
    client: input.client,
    entryPoint: { abi: entryPoint07Abi, address: PILOT_ENTRY_POINT, version: '0.7' },
    async getAddress() { return input.address },
    async getFactoryArgs() { return {} },
    async getNonce({ key = 0n } = {}) {
      return input.client.readContract({
        abi: entryPoint07Abi,
        address: PILOT_ENTRY_POINT,
        functionName: 'getNonce',
        args: [input.address, key],
      })
    },
    async encodeCalls(calls) {
      if (calls.length !== 1) throw new TypeError('The MetaMask Base Sepolia pilot only encodes one zero-value call')
      const [call] = calls
      if (call.to.toLowerCase() !== zeroAddress.toLowerCase() || (call.value ?? 0n) !== 0n || (call.data ?? '0x') !== '0x') throw new TypeError('The MetaMask Base Sepolia pilot only encodes its zero-value no-op call')
      return encodeMetaMask7702PilotCall(call.to)
    },
    async getStubSignature() { return META_MASK_EOA_STUB_SIGNATURE },
    async signMessage(parameters) {
      return input.walletClient.signMessage({ account: input.address, ...parameters })
    },
    async signTypedData(parameters) {
      return input.walletClient.signTypedData({ account: input.address, ...parameters } as never)
    },
    async signUserOperation(parameters) {
      const { chainId = PILOT_CHAIN_ID, ...request } = parameters
      if (chainId !== PILOT_CHAIN_ID) throw new TypeError('MetaMask 7702 signature is restricted to Base Sepolia')
      if (request.sender !== undefined && request.sender.toLowerCase() !== input.address.toLowerCase()) throw new TypeError('MetaMask UserOperation sender does not match the connected EOA')
      const packed = toPackedUserOperation({ ...request, sender: input.address, signature: '0x' } as UserOperation<'0.7'>, { forHash: true })
      const typedData = {
        domain: { name: 'EIP7702StatelessDeleGator', version: '1', chainId, verifyingContract: input.address },
        types: signablePackedUserOperationTypes,
        primaryType: 'PackedUserOperation',
        message: {
          sender: packed.sender,
          nonce: packed.nonce,
          initCode: packed.initCode,
          callData: packed.callData,
          accountGasLimits: packed.accountGasLimits,
          preVerificationGas: packed.preVerificationGas,
          gasFees: packed.gasFees,
          paymasterAndData: packed.paymasterAndData,
          entryPoint: PILOT_ENTRY_POINT,
        },
      } as const
      const locallyComputedDigest = hashTypedData(typedData)
      const onChainDigest = await input.client.readContract({
        abi: delegationAbi,
        address: input.address,
        functionName: 'getPackedUserOperationTypedDataHash',
        args: [packed as never],
      })
      if (locallyComputedDigest.toLowerCase() !== onChainDigest.toLowerCase()) throw new Error('Local MetaMask UserOperation signing digest does not match the delegated account onchain')

      const signature = await input.walletClient.signTypedData({ account: input.address, ...typedData } as never)
      const recovered = await recoverTypedDataAddress({ ...typedData, signature })
      if (recovered.toLowerCase() !== input.address.toLowerCase()) throw new Error('MetaMask signed the UserOperation as a different account')
      return signature
    },
  })
}
