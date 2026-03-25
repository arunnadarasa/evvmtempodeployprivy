import { useState } from 'react';
import { useAccount } from 'wagmi';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { DeploymentStepCard } from '@/components/DeploymentStepCard';
import { ManifestCard } from '@/components/ManifestCard';
import { NetworkBadge } from '@/components/NetworkBadge';
import { useEVVMDeployment } from '@/hooks/useEVVMDeployment';
import { hasBytecodes } from '@/lib/contracts/bytecodes';
import type { StepStatus } from '@/components/StatusCircle';
import type { DeploymentRecord } from '@/lib/storage';
import { AlertTriangle, Rocket, Copy } from 'lucide-react';
import { PrivyConnectButton } from '@/components/privy/PrivyConnectButton';
import { useWallets } from '@privy-io/react-auth';
import { toast } from '@/components/ui/sonner';

function EmbeddedWalletFundRow({ connectedAddress }: { connectedAddress?: string }) {
  const { wallets, ready } = useWallets();
  const embedded =
    wallets.find(
      (w: { walletClientType?: string; chainType?: string }) =>
        w?.walletClientType === 'privy' && w?.chainType === 'ethereum'
    ) ??
    wallets.find((w: { chainType?: string }) => w?.chainType === 'ethereum') ??
    wallets[0];
  const fromPrivy = embedded?.address as string | undefined;
  const addr =
    (fromPrivy && /^0x[a-fA-F0-9]{40}$/.test(fromPrivy) ? fromPrivy : undefined) ??
    (connectedAddress && /^0x[a-fA-F0-9]{40}$/.test(connectedAddress) ? connectedAddress : undefined);
  if (!addr) return null;

  const copyAddress = () => {
    void navigator.clipboard.writeText(addr);
    toast.success('Address copied — Tempo sponsorship should cover gas; fund if needed.');
  };

  return (
    <div className="rounded-md border border-primary/20 bg-muted/40 p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium">Wallet to fund (native gas, if needed)</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1.5 shrink-0"
          onClick={copyAddress}
        >
          <Copy className="h-3.5 w-3.5" />
          Copy address
        </Button>
      </div>
      <code className="block text-[11px] font-mono break-all text-foreground bg-background rounded border border-border px-2 py-2 select-all">
        {addr}
      </code>
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        {!ready && !fromPrivy ? (
          <>Using your connected wallet address. </>
        ) : null}
        If your platform runs a <strong>dedicated deploy treasury</strong>, you may skip funding this wallet. Otherwise fund it on <strong>Tempo Testnet (Moderato)</strong> only if sponsorship fails.
      </p>
    </div>
  );
}

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
  { title: 'Setup EVVM', description: 'Connect NameService & Treasury to Core' },
  { title: 'Setup Staking', description: 'Connect Estimator & EVVM to Staking' },
];

type Phase = 'configure' | 'deploy' | 'complete';

export default function Deploy() {
  const { address, isConnected, chain } = useAccount();
  const { deploying, progress, error, deploy, canDeploy } = useEVVMDeployment();
  const [phase, setPhase] = useState<Phase>('configure');
  const [completedDeployment, setCompletedDeployment] = useState<DeploymentRecord | null>(null);
  const bytesReady = hasBytecodes();

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
          Connect your wallet to deploy EVVM contracts on Tempo Testnet (Moderato).
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
          <p className="text-xs text-muted-foreground">7-step contract deployment wizard</p>
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
                <EmbeddedWalletFundRow connectedAddress={address ?? undefined} />
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
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs">Addresses</Label>
                    <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={fillAddress}>
                      Use Connected Wallet
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
                  Deploy 5 Contracts
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
            <EmbeddedWalletFundRow />
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
