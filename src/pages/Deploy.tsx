import { useState } from 'react';
import { useAccount, useBalance } from 'wagmi';
import { motion, AnimatePresence } from 'framer-motion';
import { tempoModerato } from 'viem/chains';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { DeploymentStepCard } from '@/components/DeploymentStepCard';
import { ManifestCard } from '@/components/ManifestCard';
import { NetworkBadge } from '@/components/NetworkBadge';
import { useEVVMDeployment } from '@/hooks/useEVVMDeployment';
import { useTempoFaucet } from '@/hooks/useTempoFaucet';
import { hasBytecodes } from '@/lib/contracts/bytecodes';
import { PATH_USD_ADDRESS } from '@/lib/tempo';
import type { StepStatus } from '@/components/StatusCircle';
import type { DeploymentRecord } from '@/lib/storage';
import { AlertTriangle, Copy, Rocket, ShieldCheck } from 'lucide-react';
import { PrivyConnectButton } from '@/components/privy/PrivyConnectButton';
import { toast } from 'sonner';

function CopyFieldButton({ value }: { value: string }) {
  if (!value || !/^0x[a-fA-F0-9]{40}$/.test(value)) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 w-7 p-0 shrink-0"
      title="Copy address"
      onClick={() => {
        void navigator.clipboard.writeText(value);
        toast.success('Copied');
      }}
    >
      <Copy className="h-3.5 w-3.5" />
    </Button>
  );
}

const DEPLOYMENT_STEPS = [
  { title: 'Staking', description: 'Deploy Staking contract (no dependencies)' },
  { title: 'EVVM Core', description: 'Deploy Core contract (requires Staking)' },
  { title: 'NameService', description: 'Deploy NameService (requires Core)' },
  { title: 'Estimator', description: 'Deploy Estimator (requires Core + Staking)' },
  { title: 'Treasury', description: 'Deploy Treasury (requires Core)' },
  { title: 'P2PSwap', description: 'Deploy P2PSwap (requires Core + Staking)' },
  { title: 'Setup EVVM', description: 'Connect NameService & Treasury to Core' },
  { title: 'Setup Staking', description: 'Connect Estimator & EVVM to Staking' },
];

type Phase = 'configure' | 'deploy' | 'complete';

export default function Deploy() {
  const { address, isConnected, chain } = useAccount();
  const { deploying, progress, error, deploy, canDeploy } = useEVVMDeployment();
  const {
    pathUsdBalanceFormatted,
    isFunding,
    isRefreshing,
    error: faucetError,
    requestPathUsd,
    refreshBalance,
  } = useTempoFaucet(address);
  const { data: nativeTempoBalance } = useBalance({
    address,
    chainId: tempoModerato.id,
    query: {
      enabled: !!address,
    },
  });
  const [phase, setPhase] = useState<Phase>('configure');
  const [completedDeployment, setCompletedDeployment] = useState<DeploymentRecord | null>(null);
  const bytesReady = hasBytecodes();
  const isTempoDirectWalletMode = chain?.id === tempoModerato.id;

  // Form state
  const [evvmName, setEvvmName] = useState('');
  const [tokenName, setTokenName] = useState('MATE');
  const [tokenSymbol, setTokenSymbol] = useState('MATE');
  const [adminAddr, setAdminAddr] = useState('');
  const [goldenFisher, setGoldenFisher] = useState('');
  const [activator, setActivator] = useState('');

  // Auto-fill connected address
  const fillAddress = () => {
    if (address) {
      if (!adminAddr) setAdminAddr(address);
      if (!goldenFisher) setGoldenFisher(address);
      if (!activator) setActivator(address);
    }
  };

  const handleDeploy = async () => {
    if (!address) return;
    setPhase('deploy');

    const result = await deploy({
      adminAddress: (adminAddr || address) as `0x${string}`,
      goldenFisherAddress: (goldenFisher || address) as `0x${string}`,
      activatorAddress: (activator || address) as `0x${string}`,
      evvmName,
      principalTokenName: tokenName,
      principalTokenSymbol: tokenSymbol,
      totalSupply: BigInt(0),
      eraTokens: BigInt(0),
      rewardPerOperation: BigInt(0),
    });

    if (result) {
      setCompletedDeployment(result);
      setPhase('complete');
    }
  };

  const getStepStatus = (stepIndex: number): StepStatus => {
    if (!progress) return 'pending';
    const currentStep = progress.step;
    if (stepIndex + 1 < currentStep) return 'completed';
    if (stepIndex + 1 === currentStep) {
      if (progress.stage === 'failed') return 'failed';
      return 'active';
    }
    return 'pending';
  };

  if (!isConnected) {
    return (
      <main className="container max-w-lg px-4 py-16 text-center">
        <Rocket className="h-8 w-8 text-primary mx-auto mb-4" />
        <h1 className="text-xl font-bold mb-2">Connect Wallet to Deploy</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Connect with Privy to use your social-login wallet for EVVM setup, wallet funding, and paid Tempo testnet deployments from the embedded wallet.
        </p>
        <div className="flex justify-center">
          <PrivyConnectButton size="default" />
        </div>
      </main>
    );
  }

  return (
    <main className="container max-w-2xl px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold">Deploy EVVM Instance</h1>
          <p className="text-xs text-muted-foreground">8-step contract deployment wizard</p>
        </div>
        {chain && <NetworkBadge chainId={chain.id} />}
      </div>

      {!bytesReady && (
        <div className="rounded-md border border-warning/30 bg-warning/5 p-3 mb-6 flex gap-3">
          <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-medium text-warning">Bytecodes Not Configured</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Contract bytecodes must be compiled from <code className="font-mono text-foreground">@evvm/testnet-contracts</code> using Foundry.
              Update <code className="font-mono text-foreground">src/lib/contracts/bytecodes.ts</code> with compiled output, or use the EVVM CLI: <code className="font-mono text-foreground">npx @evvm/testnet-contracts evvm deploy</code>
            </p>
          </div>
        </div>
      )}

      <div className="rounded-md border border-primary/30 bg-primary/5 p-3 mb-6 flex gap-3">
        <ShieldCheck className="h-4 w-4 text-primary shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-medium text-primary">
            {isTempoDirectWalletMode ? 'Funded Privy Wallet Deploy Mode' : 'Privy Social Wallet Mode'}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">
            {isTempoDirectWalletMode ? (
              <>
                Keep <strong>Privy for auth and wallet ownership</strong>. On Tempo testnet, deployments now use the
                <strong> funded embedded wallet directly</strong>, so this flow relies on wallet gas rather than sponsorship.
              </>
            ) : (
              <>
                Keep <strong>Privy for auth and wallet ownership</strong>. Use this wallet as the account you fund for test flows, while <strong>ZeroDev sponsorship</strong> is applied only where Tempo supports the action cleanly.
              </>
            )}
          </p>
        </div>
      </div>

      {!isTempoDirectWalletMode && (
        <div className="rounded-md border border-warning/30 bg-warning/5 p-3 mb-6 flex gap-3">
          <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-medium text-warning">Switch To Tempo Testnet</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Tempo deployments in this app now use only the funded Privy embedded wallet on <code className="font-mono text-foreground">Tempo Testnet (Moderato)</code>.
              Sepolia is used separately for EVVM registration.
            </p>
          </div>
        </div>
      )}

      <AnimatePresence mode="wait">
        {/* Configuration Phase */}
        {phase === 'configure' && (
          <motion.div
            key="configure"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-sm">Configuration</CardTitle>
                <CardDescription className="text-xs">Set up your EVVM instance parameters</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-xs">EVVM Instance Name</Label>
                  <Input
                    value={evvmName}
                    onChange={(e) => setEvvmName(e.target.value)}
                    placeholder="my-evvm-instance"
                    className="mt-1 h-9 text-sm font-mono"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Token Name</Label>
                    <Input
                      value={tokenName}
                      onChange={(e) => setTokenName(e.target.value)}
                      placeholder="MATE"
                      className="mt-1 h-9 text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Token Symbol</Label>
                    <Input
                      value={tokenSymbol}
                      onChange={(e) => setTokenSymbol(e.target.value)}
                      placeholder="MATE"
                      className="mt-1 h-9 text-sm"
                    />
                  </div>
                </div>

                <div className="pt-2">
                  <div className="rounded-md border border-border/80 bg-background/50 p-3 mb-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Privy Wallet To Fund</Label>
                        <p className="mt-1 text-xs font-mono text-foreground break-all">{address}</p>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          Use this embedded wallet for Tempo gas, faucet-funded PathUSD, and later payment or registration signatures.
                        </p>
                      </div>
                      <CopyFieldButton value={address ?? ''} />
                    </div>
                  </div>
                  <div className="rounded-md border border-primary/20 bg-primary/5 p-3 mb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Tempo Faucet</Label>
                        <p className="mt-1 text-xs font-medium text-foreground">Request testnet PathUSD for your Privy wallet</p>
                        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                          Uses Tempo&apos;s public faucet RPC to fund the connected wallet address with <span className="font-mono text-foreground">pathUSD</span>.
                          Current balance: <span className="font-mono text-foreground">{pathUsdBalanceFormatted}</span> pathUSD
                        </p>
                        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                          Native Tempo gas balance:{' '}
                          <span className="font-mono text-foreground">
                            {nativeTempoBalance
                              ? `${nativeTempoBalance.formatted} ${nativeTempoBalance.symbol}`
                              : '0'}
                          </span>
                        </p>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          Contract deployment uses normal paid transactions and needs native Tempo gas in this funded wallet. PathUSD does not cover deployment gas.
                        </p>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          Token: <span className="font-mono text-foreground break-all">{PATH_USD_ADDRESS}</span>
                        </p>
                        {faucetError && (
                          <p className="mt-2 text-[10px] text-destructive">{faucetError}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col gap-2">
                        <Button
                          type="button"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={!address || isFunding}
                          onClick={() => void requestPathUsd(address)}
                        >
                          {isFunding ? 'Requesting…' : 'Request PathUSD'}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={!address || isRefreshing}
                          onClick={() => void refreshBalance(address)}
                        >
                          {isRefreshing ? 'Refreshing…' : 'Refresh'}
                        </Button>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs">Addresses</Label>
                    <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={fillAddress}>
                      Use Privy Wallet
                    </Button>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Admin Address</Label>
                      <div className="flex gap-1 mt-0.5 items-center">
                        <Input
                          value={adminAddr}
                          onChange={(e) => setAdminAddr(e.target.value)}
                          placeholder={address}
                          className="h-8 text-xs font-mono flex-1 min-w-0"
                        />
                        <CopyFieldButton value={adminAddr} />
                      </div>
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Golden Fisher Address</Label>
                      <div className="flex gap-1 mt-0.5 items-center">
                        <Input
                          value={goldenFisher}
                          onChange={(e) => setGoldenFisher(e.target.value)}
                          placeholder={address}
                          className="h-8 text-xs font-mono flex-1 min-w-0"
                        />
                        <CopyFieldButton value={goldenFisher} />
                      </div>
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Activator Address</Label>
                      <div className="flex gap-1 mt-0.5 items-center">
                        <Input
                          value={activator}
                          onChange={(e) => setActivator(e.target.value)}
                          placeholder={address}
                          className="h-8 text-xs font-mono flex-1 min-w-0"
                        />
                        <CopyFieldButton value={activator} />
                      </div>
                    </div>
                  </div>
                </div>

                <Button
                  onClick={handleDeploy}
                  disabled={!evvmName || deploying || !bytesReady || !canDeploy}
                  className="w-full h-9 text-sm glow-primary"
                >
                  <Rocket className="h-3.5 w-3.5" />
                  Deploy 6 Contracts
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Deployment Phase */}
        {phase === 'deploy' && (
          <motion.div
            key="deploy"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-2"
          >
            {DEPLOYMENT_STEPS.map((step, i) => (
              <DeploymentStepCard
                key={i}
                step={i + 1}
                title={step.title}
                description={step.description}
                status={getStepStatus(i)}
                chainId={chain?.id || 42431}
                txHash={progress?.step === i + 1 ? progress.txHash : undefined}
              />
            ))}

	            {error && (
	              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 mt-4">
	                <p className="text-xs text-destructive">{error}</p>
	                <Button
	                  variant="outline"
	                  size="sm"
                  className="mt-2 h-7 text-xs"
                  onClick={() => setPhase('configure')}
                >
                  Back to Configuration
                </Button>
              </div>
            )}
          </motion.div>
        )}

        {/* Complete Phase */}
        {phase === 'complete' && completedDeployment && (
          <motion.div
            key="complete"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <ManifestCard deployment={completedDeployment} />
            <Button
              variant="outline"
              className="w-full mt-4 h-9 text-sm"
              onClick={() => {
                setPhase('configure');
                setCompletedDeployment(null);
              }}
            >
              Deploy Another Instance
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
