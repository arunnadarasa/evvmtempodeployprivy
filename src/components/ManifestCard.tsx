import { motion } from 'framer-motion';
import { Check, Copy, Download } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { EVVM_REGISTRY_SEPOLIA_ADDRESS } from '@/lib/evvmRegistry';
import type { DeploymentRecord } from '@/lib/storage';
import { exportDeploymentJSON } from '@/lib/storage';
import { getExplorerUrl } from '@/lib/wagmi';

interface ManifestCardProps {
  deployment: DeploymentRecord;
}

export function ManifestCard({ deployment }: ManifestCardProps) {
  const [copied, setCopied] = useState(false);

  const contracts = [
    { label: 'Staking', address: deployment.stakingAddress },
    { label: 'EVVM Core', address: deployment.evvmCoreAddress },
    { label: 'NameService', address: deployment.nameServiceAddress },
    { label: 'Estimator', address: deployment.estimatorAddress },
    { label: 'Treasury', address: deployment.treasuryAddress },
    { label: 'P2PSwap', address: deployment.p2pSwapAddress },
  ];
  const registerTxHash = deployment.txHashes.registerEvvm;

  const handleCopy = () => {
    navigator.clipboard.writeText(exportDeploymentJSON(deployment));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([exportDeploymentJSON(deployment)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `evvm-${deployment.evvmName}-manifest.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isComplete = deployment.deploymentStatus === 'completed';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-md border p-4 ${
        isComplete ? 'border-success/40 glow-success' : 'border-border'
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold">{deployment.evvmName}</h3>
          <p className="text-[10px] text-muted-foreground font-mono">
            {deployment.principalTokenName} ({deployment.principalTokenSymbol})
          </p>
        </div>
        {deployment.evvmId && (
          <span className="rounded-full bg-primary/20 border border-primary/30 px-2 py-0.5 text-[10px] font-mono text-primary">
            ID: {deployment.evvmId}
          </span>
        )}
      </div>

      <div className="space-y-1.5">
        {contracts.map(
          (c) =>
            c.address && (
              <div key={c.label} className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">{c.label}</span>
                <a
                  href={getExplorerUrl(deployment.hostChainId, c.address, 'address')}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-mono text-primary hover:underline"
                >
                  {c.address.slice(0, 8)}...{c.address.slice(-6)}
                </a>
              </div>
            )
        )}
        {registerTxHash && (
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">Sepolia Registration Tx (AA)</span>
            <a
              href={getExplorerUrl(11155111, registerTxHash, 'tx')}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-mono text-primary hover:underline"
            >
              {registerTxHash.slice(0, 8)}...{registerTxHash.slice(-6)}
            </a>
          </div>
        )}
        {registerTxHash && (
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">EVVM Registry Contract (Sepolia)</span>
            <a
              href={getExplorerUrl(11155111, EVVM_REGISTRY_SEPOLIA_ADDRESS, 'address')}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-mono text-primary hover:underline"
            >
              {EVVM_REGISTRY_SEPOLIA_ADDRESS.slice(0, 8)}...{EVVM_REGISTRY_SEPOLIA_ADDRESS.slice(-6)}
            </a>
          </div>
        )}
      </div>

      {registerTxHash && (
        <p className="mt-2 text-[10px] text-muted-foreground">
          `registerEvvm(...)` runs inside the Sepolia ERC-4337 EntryPoint bundle, so the AA tx and registry context share one on-chain transaction.
        </p>
      )}

      <div className="flex gap-2 mt-3">
        <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={handleCopy}>
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy JSON'}
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleDownload}>
          <Download className="h-3 w-3" />
        </Button>
      </div>
    </motion.div>
  );
}
