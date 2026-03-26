export const EVVM_REGISTRY_SEPOLIA_ADDRESS =
  '0x389dC8fb09211bbDA841D59f4a51160dA2377832' as const;
export const ENTRYPOINT_V07_SEPOLIA_ADDRESS =
  '0x0000000071727de22e5e9d8baf0edac6f37da032' as const;

export const EVVM_TEMPO_HOST_CHAIN_ID = 42431;

export const evvmRegistryAbi = [
  {
    type: 'function',
    name: 'isChainIdRegistered',
    stateMutability: 'view',
    inputs: [{ name: 'chainId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'publicCounter',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'registerEvvm',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'chainId', type: 'uint256' },
      { name: 'evvmAddress', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getEvvmIdMetadata',
    stateMutability: 'view',
    inputs: [{ name: 'evvmId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'chainId', type: 'uint256' },
          { name: 'evvmAddress', type: 'address' },
        ],
      },
    ],
  },
] as const;

export const evvmCoreRegistrationAbi = [
  {
    type: 'function',
    name: 'getEvvmID',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'setEvvmID',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newEvvmID', type: 'uint256' }],
    outputs: [],
  },
] as const;
