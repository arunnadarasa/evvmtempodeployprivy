import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { sepolia, tempoModerato } from 'viem/chains';
import { getAddress, isAddress } from 'viem';
import { toast } from 'sonner';
import { BadgeCheck, Copy, ExternalLink, Orbit, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NetworkBadge } from '@/components/NetworkBadge';
import { PrivyConnectButton } from '@/components/privy/PrivyConnectButton';
import { useSepoliaRegistration } from '@/hooks/useSepoliaRegistration';
import { getDeployments, type DeploymentRecord } from '@/lib/storage';
import {
  ENTRYPOINT_V07_SEPOLIA_ADDRESS,
  EVVM_REGISTRY_SEPOLIA_ADDRESS,
} from '@/lib/evvmRegistry';
import { getExplorerUrl } from '@/lib/wagmi';

function formatHash(value: string) {
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function getRecentTempoCoreDeployments() {
  return getDeployments()
    .filter((deployment) => deployment.evvmCoreAddress)
    .sort((left, right) => {
      const leftTempo = left.hostChainId === 42431 ? 1 : 0;
      const rightTempo = right.hostChainId === 42431 ? 1 : 0;
      if (leftTempo !== rightTempo) return rightTempo - leftTempo;
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    })
    .slice(0, 4);
}

function CopyButton({ value }: { value: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 w-7 p-0 shrink-0"
      onClick={() => {
        void navigator.clipboard.writeText(value);
        toast.success('Copied');
      }}
      title="Copy"
    >
      <Copy className="h-3.5 w-3.5" />
    </Button>
  );
}

export default function Register() {
  const { address, isConnected, chain } = useAccount();
  const {
    chainRegistered,
    checkRegistrationStatus,
    error,
    isKernelLoading,
    isReady,
    isRegistering,
    isSwitchingChain,
    lookup,
    onSepolia,
    progress,
    register,
    switchToSepolia,
  } = useSepoliaRegistration();

  const [coreAddress, setCoreAddress] = useState('');
  const [recentDeployments, setRecentDeployments] = useState<DeploymentRecord[]>([]);
  const [lastResult, setLastResult] = useState<{
    evvmId: bigint;
    registerTxHash?: `0x${string}`;
    setIdTxHash?: `0x${string}`;
    matchedDeploymentIds?: string[];
  } | null>(null);

  useEffect(() => {
    setRecentDeployments(getRecentTempoCoreDeployments());
  }, []);

  useEffect(() => {
    setLastResult(null);

    let cancelled = false;

    if (!coreAddress.trim()) {
      void checkRegistrationStatus('');
      return;
    }

    const timer = window.setTimeout(() => {
      void checkRegistrationStatus(coreAddress).then((result) => {
        if (cancelled) return;
        // Reuse the hook state for the canonical status card, but keep local manifests fresh too.
        setRecentDeployments(getRecentTempoCoreDeployments());
      });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [coreAddress, checkRegistrationStatus]);

  const normalizedCore = useMemo(() => {
    if (!isAddress(coreAddress)) return null;
    return getAddress(coreAddress);
  }, [coreAddress]);

  const handleRegister = async () => {
    const result = await register(coreAddress);
    if (result) {
      setLastResult(result);
      setRecentDeployments(getRecentTempoCoreDeployments());
      toast.success(`Tempo EVVM ID ${result.evvmId.toString()} is registered and synced`);
    }
  };

  if (!isConnected) {
    return (
      <main className="container max-w-lg px-4 py-16 text-center">
        <Orbit className="h-8 w-8 text-primary mx-auto mb-4" />
        <h1 className="text-xl font-bold mb-2">Connect Wallet to Register</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Log in with Privy first, then use the same social wallet on Sepolia for ZeroDev-sponsored registration of your Tempo-hosted EVVM core.
        </p>
        <div className="flex justify-center">
          <PrivyConnectButton size="default" />
        </div>
      </main>
    );
  }

  return (
    <main className="container max-w-3xl px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold">Register Tempo EVVM on Sepolia</h1>
          <p className="text-xs text-muted-foreground">
            Use the Privy social wallet for auth on Sepolia, then let ZeroDev sponsor the AA bundle that executes `registerEvvm(...)` for your Tempo-hosted EVVM core before writing the assigned EVVM ID back into the Tempo core.
          </p>
        </div>
        <NetworkBadge chainId={sepolia.id} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr,0.8fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Sepolia Registration Flow</CardTitle>
              <CardDescription className="text-xs">
                Step 1 submits a Sepolia ERC-4337 EntryPoint transaction whose inner call executes `registerEvvm(...)` on the EVVM registry. Step 2 writes the assigned EVVM ID back into that Tempo core with `setEvvmID(...)`.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md border border-border/80 bg-background/40 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Privy Wallet</Label>
                    <p className="mt-1 text-xs font-mono break-all">{address}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Current network: <span className="text-foreground">{chain?.name ?? 'Unknown'}</span>
                    </p>
                  </div>
                  {address && <CopyButton value={address} />}
                </div>
              </div>

              <div className="rounded-md border border-border/80 bg-background/40 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Sepolia EntryPoint (ERC-4337)</Label>
                    <p className="mt-1 text-xs font-mono break-all">{ENTRYPOINT_V07_SEPOLIA_ADDRESS}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      The top-level on-chain Sepolia tx lands here; `registerEvvm(...)` is executed inside that AA bundle.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <CopyButton value={ENTRYPOINT_V07_SEPOLIA_ADDRESS} />
                    <Button asChild type="button" variant="ghost" size="sm" className="h-7 w-7 p-0">
                      <a
                        href={getExplorerUrl(sepolia.id, ENTRYPOINT_V07_SEPOLIA_ADDRESS, 'address')}
                        target="_blank"
                        rel="noreferrer"
                        title="Open EntryPoint"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  </div>
                </div>
              </div>

              <div className="rounded-md border border-border/80 bg-background/40 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Sepolia Registry Contract</Label>
                    <p className="mt-1 text-xs font-mono break-all">{EVVM_REGISTRY_SEPOLIA_ADDRESS}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Registry support status:{' '}
                      <span className={chainRegistered === false ? 'text-destructive' : 'text-foreground'}>
                        {chainRegistered === null
                          ? 'Checking...'
                          : chainRegistered
                            ? 'Tempo host registrations enabled'
                            : 'Tempo host registrations disabled'}
                      </span>
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <CopyButton value={EVVM_REGISTRY_SEPOLIA_ADDRESS} />
                    <Button asChild type="button" variant="ghost" size="sm" className="h-7 w-7 p-0">
                      <a
                        href={getExplorerUrl(sepolia.id, EVVM_REGISTRY_SEPOLIA_ADDRESS, 'address')}
                        target="_blank"
                        rel="noreferrer"
                        title="Open registry"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-xs">EVVM Core Address on Tempo Testnet</Label>
                <Input
                  value={coreAddress}
                  onChange={(event) => setCoreAddress(event.target.value)}
                  placeholder="0x..."
                  className="mt-1 h-9 text-sm font-mono"
                />
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Paste the already deployed EVVM Core contract address that lives on Tempo Testnet (Moderato).
                </p>
              </div>

              <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
                <p className="text-xs font-medium text-primary">Address Check</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{lookup.message}</p>
                <p className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {lookup.state}
                  {lookup.evvmId != null ? ` • EVVM ID ${lookup.evvmId.toString()}` : ''}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {!onSepolia ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void switchToSepolia()}
                    disabled={isSwitchingChain}
                    className="h-9 text-sm"
                  >
                    {isSwitchingChain ? 'Switching…' : 'Switch to Sepolia'}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  onClick={() => void handleRegister()}
                  disabled={
                    !normalizedCore ||
                    !isReady ||
                    isRegistering ||
                    chainRegistered === false ||
                    (lookup.state === 'registered' && !lookup.needsCoreSync)
                  }
                  className="h-9 text-sm glow-primary"
                >
                  {isRegistering
                    ? 'Registering…'
                    : lookup.state === 'registered' && lookup.needsCoreSync
                      ? 'Sync Tempo Core ID'
                      : 'Register Tempo EVVM'}
                </Button>
              </div>

              {error ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                  <p className="text-xs font-medium text-destructive">Registration Error</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{error}</p>
                </div>
              ) : null}

              <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
                <p className="text-xs font-medium text-primary">Status</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{progress.message}</p>
                <p className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {progress.stage}
                  {isKernelLoading ? ' • preparing ZeroDev client' : ''}
                </p>
              </div>

              {lastResult ? (
                <div className="rounded-md border border-success/30 bg-success/5 p-3">
                  <div className="flex items-center gap-2 text-success">
                    <BadgeCheck className="h-4 w-4" />
                    <p className="text-xs font-medium">
                      Sepolia registry registration complete with EVVM ID {lastResult.evvmId.toString()}
                    </p>
                  </div>
                  <div className="mt-3 space-y-2 text-[11px]">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Sepolia EntryPoint Tx</span>
                      {lastResult.registerTxHash ? (
                        <a
                          href={getExplorerUrl(sepolia.id, lastResult.registerTxHash, 'tx')}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-primary hover:underline"
                        >
                          {formatHash(lastResult.registerTxHash)}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">Already existed</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">EVVM Registry Contract</span>
                      <a
                        href={getExplorerUrl(sepolia.id, EVVM_REGISTRY_SEPOLIA_ADDRESS, 'address')}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-primary hover:underline"
                      >
                        {formatHash(EVVM_REGISTRY_SEPOLIA_ADDRESS)}
                      </a>
                    </div>
                    {lastResult.setIdTxHash ? (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">Tempo `setEvvmID` Tx</span>
                        <a
                          href={getExplorerUrl(tempoModerato.id, lastResult.setIdTxHash, 'tx')}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-primary hover:underline"
                        >
                          {formatHash(lastResult.setIdTxHash)}
                        </a>
                      </div>
                    ) : null}
                    <p className="text-muted-foreground">
                      The Sepolia registry write is executed inside the EntryPoint AA bundle, so there is one Sepolia on-chain tx hash and one EVVM registry contract context.
                    </p>
                    {lastResult.matchedDeploymentIds?.length ? (
                      <p className="text-muted-foreground">
                        Local manifest updated. You can review it in the{' '}
                        <Link to="/dashboard" className="text-primary hover:underline">
                          dashboard
                        </Link>
                        .
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Recent Local Tempo Cores</CardTitle>
              <CardDescription className="text-xs">
                Pull a Tempo-hosted core address from a local manifest if you already have one saved here.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {recentDeployments.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No local Tempo EVVM manifests with a core address yet. Paste a Tempo core address manually.
                </p>
              ) : (
                recentDeployments.map((deployment) => (
                  <div
                    key={deployment.id}
                    className="rounded-md border border-border/80 bg-background/40 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium">{deployment.evvmName}</p>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          Saved on {new Date(deployment.createdAt).toLocaleDateString()}
                        </p>
                        <p className="mt-2 text-[11px] font-mono break-all">
                          {deployment.evvmCoreAddress}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs shrink-0"
                        onClick={() => setCoreAddress(deployment.evvmCoreAddress ?? '')}
                      >
                        Use
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Before You Submit</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <p>Make sure the active Privy wallet is switched to Sepolia before pressing register.</p>
              <p>The core address should be the Tempo Testnet (Moderato) EVVM core you already deployed. This page does not deploy the core.</p>
              <p>Registration is sponsored through ZeroDev on Sepolia as an ERC-4337 EntryPoint transaction, and the inner call writes to the EVVM registry contract.</p>
              <p>The assigned EVVM ID is then written back into the Tempo core from the funded Privy wallet on Tempo Testnet.</p>
              <Button asChild type="button" variant="outline" size="sm" className="mt-2 h-7 text-xs">
                <Link to="/dashboard">
                  <RefreshCw className="h-3 w-3" />
                  Open Dashboard
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
