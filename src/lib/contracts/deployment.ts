import {
  type PublicClient,
  type Hash,
  type Address,
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  getContractAddress,
} from 'viem';
import {
  EvvmABI,
  StakingABI,
  NameServiceABI,
  EstimatorABI,
} from '@evvm/viem-signature-library';
import {
  STAKING_BYTECODE,
  EVVM_CORE_BYTECODE,
  NAME_SERVICE_BYTECODE,
  ESTIMATOR_BYTECODE,
  TREASURY_BYTECODE,
} from './bytecodes';

/** EVVM: principal token virtual address shares Core prefix, last byte 0x01 (EIP-55 checksummed for viem ABI encoding). */
function principalTokenVirtualAddress(evvmCore: Address): Address {
  const body = `${evvmCore.slice(2, 40)}01`.toLowerCase();
  return getAddress(`0x${body}` as `0x${string}`);
}

export type DeploymentStage =
  | 'idle'
  | 'deploying-staking'
  | 'deploying-core'
  | 'deploying-nameservice'
  | 'deploying-estimator'
  | 'deploying-treasury'
  | 'setup-evvm'
  | 'setup-staking'
  | 'deployment-complete'
  | 'switching-to-sepolia'
  | 'registering'
  | 'switching-back'
  | 'configuring-evvm-id'
  | 'complete'
  | 'failed';

export interface DeploymentProgress {
  stage: DeploymentStage;
  message: string;
  txHash?: string;
  step: number;
  totalSteps: number;
}

export interface DeploymentConfig {
  adminAddress: Address;
  goldenFisherAddress: Address;
  activatorAddress: Address;
  evvmName: string;
  principalTokenName: string;
  principalTokenSymbol: string;
  totalSupply: bigint;
  eraTokens: bigint;
  rewardPerOperation: bigint;
}

export interface ContractAddresses {
  staking?: Address;
  evvmCore?: Address;
  nameService?: Address;
  estimator?: Address;
  treasury?: Address;
}

/** ZeroDev zd_sponsorUserOperation rejects UserOps with callData past ~32KB (error misreported as "invalid hex"). */
export const ZERODEV_SPONSOR_CALLDATA_CHAR_LIMIT = 32600;
/** Core initcode is large enough that Kernel-wrapped UserOp exceeds sponsor limit; Staking-sized deploys stay under. */
const CORE_INITCODE_BYTES = (EVVM_CORE_BYTECODE.length - 2) / 2;
const STAKING_INITCODE_BYTES = (STAKING_BYTECODE.length - 2) / 2;

/** Some RPCs return receipt before eth_getCode serves the new contract; try multiple CREATE candidates for wallet deploys. */
async function resolveDeployedContractAddress(
  publicClient: PublicClient,
  candidates: Address[],
  txHash: Hash
): Promise<Address> {
  const unique = [...new Set(candidates.map((a) => getAddress(a)))];
  if (unique.length === 0) {
    throw new Error('No contract address in receipt');
  }

  const readCodeLen = async (addr: Address) => {
    const code = await publicClient.getCode({ address: addr });
    return code && code !== '0x' ? code.length : 0;
  };

  for (const addr of unique) {
    const len = await readCodeLen(addr);
    if (len > 0) return addr;
  }

  // #region agent log
  fetch('http://127.0.0.1:7320/ingest/71c8c4fb-0b3d-4f6d-866d-53840d69f636', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '7a9c6a' },
    body: JSON.stringify({
      sessionId: '7a9c6a',
      runId: 'bytecode-verify',
      hypothesisId: 'H-bytecode-empty',
      location: 'deployment.ts:resolveDeployedContractAddress',
      message: 'getCode empty for all candidates after receipt',
      data: {
        txHash,
        candidateCount: unique.length,
        candidates: unique,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  return await new Promise<Address>((resolve, reject) => {
    let ticks = 0;
    const maxTicks = 35;
    const unwatch = publicClient.watchBlockNumber({
      emitOnBegin: true,
      poll: true,
      pollingInterval: 2_000,
      onBlockNumber: async () => {
        ticks += 1;
        try {
          for (const addr of unique) {
            const len = await readCodeLen(addr);
            if (len > 0) {
              unwatch();
              // #region agent log
              fetch('http://127.0.0.1:7320/ingest/71c8c4fb-0b3d-4f6d-866d-53840d69f636', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '7a9c6a' },
                body: JSON.stringify({
                  sessionId: '7a9c6a',
                  runId: 'bytecode-verify',
                  hypothesisId: 'H-RPC-lag',
                  location: 'deployment.ts:resolveDeployedContractAddress',
                  message: 'bytecode appeared after block poll',
                  data: { txHash, resolvedAddress: addr, ticks },
                  timestamp: Date.now(),
                }),
              }).catch(() => {});
              // #endregion
              resolve(addr);
              return;
            }
          }
          if (ticks >= maxTicks) {
            unwatch();
            reject(new Error('Contract bytecode verification failed'));
          }
        } catch (e) {
          unwatch();
          reject(e);
        }
      },
    });
  });
}

export type SendSponsoredTransaction = (input: {
  chainId: number;
  to?: Address;
  data: `0x${string}`;
  value?: bigint;
  /** When present, use ZeroDev encodeDeployCallData + sendTransaction for sponsored deploy */
  deployParams?: { abi: any; bytecode: `0x${string}`; args: any[] };
  /** Deploy contract via EOA (Privy) — gas not sponsored; used when Kernel UserOp exceeds sponsor size */
  walletContractDeploy?: boolean;
}) => Promise<Hash>;

async function deployContractWithRetry(
  publicClient: PublicClient,
  sendSponsoredTransaction: SendSponsoredTransaction,
  params: {
    abi: any;
    bytecode: `0x${string}`;
    args: any[];
    chainId: number;
    /** Smart account that performs CREATE (ZeroDev kernel); bundler txs have no receipt.contractAddress */
    aaDeployerAddress?: Address;
    walletContractDeploy?: boolean;
    /** EOA that signs Core CREATE (treasury or embedded); used when receipt.contractAddress is missing or stale. */
    walletDeployerAddress?: Address;
  },
  maxRetries: number = 1
): Promise<{ address: Address; txHash: Hash }> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const aaForNonce =
        params.walletContractDeploy ? undefined : params.aaDeployerAddress;
      let preCreateNonce: bigint | null = null;
      if (aaForNonce != null) {
        preCreateNonce = BigInt(
          await publicClient.getTransactionCount({
            address: aaForNonce,
            blockTag: 'latest',
          })
        );
      }
      const walletFrom =
        params.walletContractDeploy && params.walletDeployerAddress
          ? params.walletDeployerAddress
          : undefined;
      let preWalletNonce: bigint | null = null;
      if (walletFrom != null) {
        preWalletNonce = BigInt(
          await publicClient.getTransactionCount({
            address: walletFrom,
            blockTag: 'latest',
          })
        );
      }

      const deployData = encodeDeployData({
        abi: params.abi,
        bytecode: params.bytecode,
        args: params.args,
      }) as `0x${string}`;

      const hash = await sendSponsoredTransaction({
        chainId: params.chainId,
        data: deployData,
        deployParams: { abi: params.abi, bytecode: params.bytecode, args: params.args },
        walletContractDeploy: params.walletContractDeploy,
      });

      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        timeout: 120_000,
      });

      if (receipt.status === 'reverted') {
        throw new Error('Deployment transaction reverted');
      }

      let contractAddress: Address | undefined = receipt.contractAddress ?? undefined;
      if (!contractAddress && aaForNonce != null && preCreateNonce != null) {
        const aa = aaForNonce;
        // Historical eth_getTransactionCount(addr, blockHex) fails on some Base Sepolia RPCs ("header not found").
        // Use latest only: snapshot pre-nonce before send, then wait until latest nonce reflects the new CREATE.
        let postCreateNonce = BigInt(
          await publicClient.getTransactionCount({ address: aa, blockTag: 'latest' })
        );
        if (postCreateNonce <= preCreateNonce) {
          await new Promise<void>((resolve, reject) => {
            let ticks = 0;
            const maxTicks = 40;
            const unwatch = publicClient.watchBlockNumber({
              emitOnBegin: true,
              poll: true,
              pollingInterval: 2_000,
              onBlockNumber: async () => {
                ticks += 1;
                try {
                  postCreateNonce = BigInt(
                    await publicClient.getTransactionCount({ address: aa, blockTag: 'latest' })
                  );
                  if (postCreateNonce > preCreateNonce!) {
                    unwatch();
                    resolve();
                  } else if (ticks >= maxTicks) {
                    unwatch();
                    reject(
                      new Error(
                        'Smart account CREATE nonce did not increment after sponsored deploy (UserOp may have reverted).'
                      )
                    );
                  }
                } catch (e) {
                  unwatch();
                  reject(e);
                }
              },
            });
          });
        }
        const lastCreateNonce = postCreateNonce - 1n;
        contractAddress = getContractAddress({
          from: aa,
          nonce: lastCreateNonce,
          opcode: 'CREATE',
        });
        // #region agent log
        fetch('http://127.0.0.1:7320/ingest/71c8c4fb-0b3d-4f6d-866d-53840d69f636', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '7a9c6a' },
          body: JSON.stringify({
            sessionId: '7a9c6a',
            runId: 'deploy',
            hypothesisId: 'H-RPC-latest-nonce',
            location: 'deployment.ts:deployContractWithRetry',
            message: 'AA deploy address via pre/post latest CREATE nonce',
            data: {
              aaDeployerAddress: aa,
              preCreateNonce: preCreateNonce.toString(),
              postCreateNonce: postCreateNonce.toString(),
              lastCreateNonce: lastCreateNonce.toString(),
              predictedAddress: contractAddress,
              receiptBlock: receipt.blockNumber.toString(),
              txHash: hash,
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
      }

      if (!contractAddress && walletFrom != null && preWalletNonce != null) {
        let postW = BigInt(
          await publicClient.getTransactionCount({
            address: walletFrom,
            blockTag: 'latest',
          })
        );
        if (postW <= preWalletNonce) {
          await new Promise<void>((resolve, reject) => {
            let ticks = 0;
            const maxTicks = 40;
            const unwatch = publicClient.watchBlockNumber({
              emitOnBegin: true,
              poll: true,
              pollingInterval: 2_000,
              onBlockNumber: async () => {
                ticks += 1;
                try {
                  postW = BigInt(
                    await publicClient.getTransactionCount({
                      address: walletFrom,
                      blockTag: 'latest',
                    })
                  );
                  if (postW > preWalletNonce) {
                    unwatch();
                    resolve();
                  } else if (ticks >= maxTicks) {
                    unwatch();
                    reject(
                      new Error(
                        'Wallet deployer nonce did not increment after Core deploy (transaction may have reverted).'
                      )
                    );
                  }
                } catch (e) {
                  unwatch();
                  reject(e);
                }
              },
            });
          });
        }
        contractAddress = getContractAddress({
          from: walletFrom,
          nonce: postW - 1n,
          opcode: 'CREATE',
        });
      }

      const candidates: Address[] = [];
      if (contractAddress) candidates.push(contractAddress);
      if (walletFrom != null && preWalletNonce != null) {
        const postW = BigInt(
          await publicClient.getTransactionCount({
            address: walletFrom,
            blockTag: 'latest',
          })
        );
        if (postW > preWalletNonce) {
          const predicted = getContractAddress({
            from: walletFrom,
            nonce: postW - 1n,
            opcode: 'CREATE',
          });
          candidates.push(predicted);
        }
      }

      if (candidates.length === 0) {
        throw new Error('No contract address in receipt');
      }

      const resolved = await resolveDeployedContractAddress(
        publicClient,
        candidates,
        hash
      );

      return { address: resolved, txHash: hash };
    } catch (error) {
      if (attempt >= maxRetries) throw error;
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
    }
  }
  throw new Error('Deployment failed after retries');
}

export async function deployEVVMContracts(
  config: DeploymentConfig,
  publicClient: PublicClient,
  chainId: number,
  sendSponsoredTransaction: SendSponsoredTransaction,
  onProgress: (progress: DeploymentProgress) => void,
  options: {
    aaDeployerAddress?: Address;
    contractDeployerAddress: Address;
    /** Embedded EOA; used for Core prediction when not using treasury sponsor */
    eoaAddressForLargeDeploy?: Address;
    /** Platform treasury EOA — pays Core for every deploy; must match sponsor server key */
    treasuryDeployerAddress?: Address;
  }
): Promise<ContractAddresses> {
  const addresses: ContractAddresses = {};
  const totalSteps = 7;
  const aa = options.aaDeployerAddress;
  const deployer = options.contractDeployerAddress;
  const eoaLarge = options.eoaAddressForLargeDeploy;
  const treasuryDeployer = options.treasuryDeployerAddress;

  // Step 1: Deploy Staking
  onProgress({ stage: 'deploying-staking', message: 'Deploying Staking contract...', step: 1, totalSteps });
  const staking = await deployContractWithRetry(publicClient, sendSponsoredTransaction, {
    abi: StakingABI,
    bytecode: STAKING_BYTECODE,
    args: [config.adminAddress, config.goldenFisherAddress],
    chainId,
    aaDeployerAddress: aa,
  });
  addresses.staking = staking.address;
  onProgress({ stage: 'deploying-staking', message: 'Staking deployed', txHash: staking.txHash, step: 1, totalSteps });

  // Step 2: Deploy EVVM Core (constructor: owner, staking, EvvmMetadata tuple)
  const kernelCreateNonce = BigInt(
    await publicClient.getTransactionCount({ address: deployer, blockTag: 'latest' })
  );
  let predictedCore = getContractAddress({
    from: deployer,
    nonce: kernelCreateNonce,
    opcode: 'CREATE',
  });
  let evvmMetadata = {
    EvvmName: config.evvmName,
    EvvmID: 0n,
    principalTokenName: config.principalTokenName,
    principalTokenSymbol: config.principalTokenSymbol,
    principalTokenAddress: principalTokenVirtualAddress(predictedCore),
    totalSupply: config.totalSupply,
    eraTokens: config.eraTokens,
    reward: config.rewardPerOperation,
  };
  const deployCoreViaWallet =
    CORE_INITCODE_BYTES > STAKING_INITCODE_BYTES + 2000;
  if (deployCoreViaWallet) {
    const predictFrom = treasuryDeployer ?? eoaLarge;
    if (!predictFrom) {
      throw new Error(
        'EVVM Core creation needs a deployer (your platform deploy treasury, or the embedded wallet) with native gas on the deployment chain.'
      );
    }
    const eoaNonce = BigInt(
      await publicClient.getTransactionCount({ address: predictFrom, blockTag: 'latest' })
    );
    predictedCore = getContractAddress({
      from: predictFrom,
      nonce: eoaNonce,
      opcode: 'CREATE',
    });
    evvmMetadata = {
      ...evvmMetadata,
      principalTokenAddress: principalTokenVirtualAddress(predictedCore),
    };
  }
  onProgress({
    stage: 'deploying-core',
    message: deployCoreViaWallet
      ? treasuryDeployer
        ? 'Deploying EVVM Core (platform treasury)...'
        : 'Deploying EVVM Core (your wallet gas)...'
      : 'Deploying EVVM Core contract...',
    step: 2,
    totalSteps,
  });
  // #region agent log
  {
    const usedVirtual = evvmMetadata.principalTokenAddress;
    fetch('http://127.0.0.1:7320/ingest/71c8c4fb-0b3d-4f6d-866d-53840d69f636', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '7a9c6a' },
      body: JSON.stringify({
        sessionId: '7a9c6a',
        runId: 'post-fix',
        hypothesisId: 'H1-verify',
        location: 'deployment.ts:deployEVVMContracts:core-metadata',
        message: 'principalTokenAddress after getAddress fix',
        data: {
          predictedCore,
          principalTokenAddress: usedVirtual,
          validChecksum: usedVirtual === getAddress(usedVirtual.toLowerCase() as `0x${string}`),
          deployCoreViaWallet,
          treasuryDeployer: treasuryDeployer ?? null,
          coreInitBytes: CORE_INITCODE_BYTES,
          stakingInitBytes: STAKING_INITCODE_BYTES,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
  }
  // #endregion
  const coreWalletDeployer =
    deployCoreViaWallet && (treasuryDeployer ?? eoaLarge)
      ? (treasuryDeployer ?? eoaLarge!)
      : undefined;
  const core = await deployContractWithRetry(publicClient, sendSponsoredTransaction, {
    abi: EvvmABI,
    bytecode: EVVM_CORE_BYTECODE,
    args: [config.adminAddress, addresses.staking!, evvmMetadata],
    chainId,
    aaDeployerAddress: aa,
    walletContractDeploy: deployCoreViaWallet,
    walletDeployerAddress: coreWalletDeployer,
  });
  addresses.evvmCore = core.address;
  onProgress({ stage: 'deploying-core', message: 'EVVM Core deployed', txHash: core.txHash, step: 2, totalSteps });

  // Step 3: Deploy NameService
  onProgress({ stage: 'deploying-nameservice', message: 'Deploying NameService contract...', step: 3, totalSteps });
  const nameService = await deployContractWithRetry(publicClient, sendSponsoredTransaction, {
    abi: NameServiceABI,
    bytecode: NAME_SERVICE_BYTECODE,
    args: [addresses.evvmCore!, config.adminAddress],
    chainId,
    aaDeployerAddress: aa,
  });
  addresses.nameService = nameService.address;
  onProgress({ stage: 'deploying-nameservice', message: 'NameService deployed', txHash: nameService.txHash, step: 3, totalSteps });

  // Step 4: Deploy Estimator
  onProgress({ stage: 'deploying-estimator', message: 'Deploying Estimator contract...', step: 4, totalSteps });
  const estimator = await deployContractWithRetry(publicClient, sendSponsoredTransaction, {
    abi: EstimatorABI,
    bytecode: ESTIMATOR_BYTECODE,
    args: [
      config.activatorAddress,
      addresses.evvmCore!,
      addresses.staking!,
      config.adminAddress,
    ],
    chainId,
    aaDeployerAddress: aa,
  });
  addresses.estimator = estimator.address;
  onProgress({ stage: 'deploying-estimator', message: 'Estimator deployed', txHash: estimator.txHash, step: 4, totalSteps });

  // Step 5: Deploy Treasury
  onProgress({ stage: 'deploying-treasury', message: 'Deploying Treasury contract...', step: 5, totalSteps });
  const treasury = await deployContractWithRetry(publicClient, sendSponsoredTransaction, {
    abi: EvvmABI,
    bytecode: TREASURY_BYTECODE,
    args: [addresses.evvmCore!, config.adminAddress],
    chainId,
    aaDeployerAddress: aa,
  });
  addresses.treasury = treasury.address;
  onProgress({ stage: 'deploying-treasury', message: 'Treasury deployed', txHash: treasury.txHash, step: 5, totalSteps });

  // Step 6: Setup EVVM - Connect NameService + Treasury to Core
  onProgress({ stage: 'setup-evvm', message: 'Connecting NameService & Treasury to Core...', step: 6, totalSteps });
  const setupData1 = encodeFunctionData({
    abi: EvvmABI,
    functionName: '_setupNameServiceAndTreasuryAddress',
    args: [addresses.nameService!, addresses.treasury!],
  }) as `0x${string}`;
  const setupHash1 = await sendSponsoredTransaction({
    chainId,
    to: addresses.evvmCore!,
    data: setupData1,
  });
  await publicClient.waitForTransactionReceipt({ hash: setupHash1 });
  onProgress({
    stage: 'setup-evvm',
    message: 'NameService & Treasury connected to Core',
    txHash: setupHash1,
    step: 6,
    totalSteps,
  });

  // Step 7: Setup Staking - Connect Estimator + EVVM to Staking
  onProgress({ stage: 'setup-staking', message: 'Connecting Estimator & EVVM to Staking...', step: 7, totalSteps });
  const setupData2 = encodeFunctionData({
    abi: StakingABI,
    functionName: '_setupEstimatorAndEvvm',
    args: [addresses.estimator!, addresses.evvmCore!],
  }) as `0x${string}`;
  const setupHash2 = await sendSponsoredTransaction({
    chainId,
    to: addresses.staking!,
    data: setupData2,
  });
  await publicClient.waitForTransactionReceipt({ hash: setupHash2 });
  onProgress({ stage: 'setup-staking', message: 'Staking configured', txHash: setupHash2, step: 7, totalSteps });

  onProgress({ stage: 'deployment-complete', message: 'All contracts deployed and configured!', step: 7, totalSteps });

  return addresses;
}
