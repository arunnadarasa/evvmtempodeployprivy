import { createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sendUserOperation, waitForUserOperationReceipt } from 'viem/account-abstraction';
import { getAction } from 'viem/utils';
import { tempoModerato } from 'viem/chains';
import {
  createKernelAccount,
  createKernelAccountClient,
  createZeroDevPaymasterClient,
  constants,
} from '@zerodev/sdk';
import { signerToEcdsaValidator } from '@zerodev/ecdsa-validator';
import fs from 'node:fs';

const rpcUrl =
  'https://rpc.zerodev.app/api/v3/92691254-2986-488c-9c5d-b6028a3deb3a/chain/42431';

// Deterministic debug signer for Tempo testnet probing only.
const signer = privateKeyToAccount(
  '0x59c6995e998f97a5a0044966f094538c5f9f5c9b7f7e7f8f8d8f7f8f8d8f7f8f'
);

const publicClient = createPublicClient({
  chain: tempoModerato,
  transport: http(tempoModerato.rpcUrls.default.http[0]),
});

const entryPoint = constants.getEntryPoint('0.7');
const kernelVersion = constants.KERNEL_V3_1;
const bytecodesSource = fs.readFileSync(
  new URL('../src/lib/contracts/bytecodes.ts', import.meta.url),
  'utf8'
);
const stakingAbiJson = JSON.parse(
  fs.readFileSync(
    new URL('../node_modules/@evvm/viem-signature-library/src/abi/Staking.json', import.meta.url),
    'utf8'
  )
);
const stakingAbi = stakingAbiJson.abi;
const stakingBytecodeMatch = bytecodesSource.match(
  /export const STAKING_BYTECODE = "(0x[0-9a-fA-F]+)"/
);
if (!stakingBytecodeMatch) {
  throw new Error('Could not parse STAKING_BYTECODE');
}
const STAKING_BYTECODE = stakingBytecodeMatch[1];

function sponsoredDeployCallGasLimit(bytecode) {
  const byteLen = BigInt((bytecode.length - 2) / 2);
  const estimated = 1_200_000n + byteLen * 400n;
  const minGas = 1_800_000n;
  const maxGas = 14_000_000n;
  if (estimated < minGas) return minGas;
  if (estimated > maxGas) return maxGas;
  return estimated;
}

async function runDeployProbe({
  label,
  kernelAccount,
  kernelClient,
  abi,
  bytecode,
  args,
  callGasLimit,
}) {
  try {
    const callData = await kernelAccount.encodeDeployCallData({
      abi,
      bytecode,
      args,
    });
    const sendUserOp = getAction(
      kernelClient,
      sendUserOperation,
      'sendUserOperation'
    );
    const waitUoReceipt = getAction(
      kernelClient,
      waitForUserOperationReceipt,
      'waitForUserOperationReceipt'
    );
    const userOpHash = await sendUserOp({
      account: kernelAccount,
      callData,
      callGasLimit,
    });
    const receipt = await waitUoReceipt({ hash: userOpHash });
    console.log(
      `${label} ok`,
      JSON.stringify(
        {
          userOpHash,
          txHash: receipt.receipt.transactionHash,
          success: receipt.success,
          reason: receipt.reason ?? null,
          callDataLen: callData.length,
          callGasLimit: callGasLimit.toString(),
        },
        null,
        2
      )
    );
  } catch (error) {
    console.log(
      `${label} err`,
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function buildClient(useMetaFactory) {
  const validator = await signerToEcdsaValidator(publicClient, {
    signer,
    entryPoint,
    kernelVersion,
  });

  const kernelAccount = await createKernelAccount(publicClient, {
    plugins: { sudo: validator },
    entryPoint,
    kernelVersion,
    useMetaFactory,
  });

  const paymasterClient = createZeroDevPaymasterClient({
    chain: tempoModerato,
    transport: http(rpcUrl),
  });

  const kernelClient = createKernelAccountClient({
    account: kernelAccount,
    chain: tempoModerato,
    bundlerTransport: http(rpcUrl),
    client: publicClient,
    paymaster: {
      getPaymasterData: (parameters) =>
        paymasterClient.sponsorUserOperation({ userOperation: parameters }),
    },
  });

  return { kernelAccount, kernelClient };
}

async function probe(useMetaFactory) {
  const label = useMetaFactory ? 'meta-factory' : 'direct-factory';
  console.log(`\n== ${label} ==`);

  const { kernelAccount, kernelClient } = await buildClient(useMetaFactory);
  console.log('sender', kernelAccount.address);

  try {
    const hash = await kernelClient.sendTransaction({
      account: kernelAccount,
      to: signer.address,
      value: 0n,
      data: '0x',
    });
    console.log('simple-call ok', hash);
  } catch (error) {
    console.log(
      'simple-call err',
      error instanceof Error ? error.message : String(error)
    );
  }

  await runDeployProbe({
    label: 'tiny-deploy',
    kernelAccount,
    kernelClient,
    abi: [],
    bytecode: '0x6001600c60003960016000f300',
    args: [],
    callGasLimit: 800000n,
  });

  await runDeployProbe({
    label: 'staking-deploy',
    kernelAccount,
    kernelClient,
    abi: stakingAbi,
    bytecode: STAKING_BYTECODE,
    args: [signer.address, signer.address],
    callGasLimit: sponsoredDeployCallGasLimit(STAKING_BYTECODE),
  });

  await runDeployProbe({
    label: 'staking-deploy-hi-gas',
    kernelAccount,
    kernelClient,
    abi: stakingAbi,
    bytecode: STAKING_BYTECODE,
    args: [signer.address, signer.address],
    callGasLimit: 14000000n,
  });
}

await probe(true);
await probe(false);
