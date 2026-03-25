import { cn } from '@/lib/utils';
import { StatusCircle, type StepStatus } from './StatusCircle';
import { ExternalLink } from 'lucide-react';
import { getExplorerUrl } from '@/lib/wagmi';

interface DeploymentStepCardProps {
  step: number;
  title: string;
  description: string;
  status: StepStatus;
  txHash?: string;
  chainId: number;
  contractAddress?: string;
}

export function DeploymentStepCard({
  step,
  title,
  description,
  status,
  txHash,
  chainId,
  contractAddress,
}: DeploymentStepCardProps) {
  return (
    <div
      className={cn(
        'relative flex gap-3 rounded-md border p-3 transition-all brand-curve',
        status === 'pending' && 'border-border bg-card/50 opacity-60',
        status === 'active' && 'border-primary/50 bg-card animate-pulse-amber',
        status === 'completed' && 'border-success/30 bg-card',
        status === 'failed' && 'border-destructive/30 bg-card'
      )}
    >
      <StatusCircle status={status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-muted-foreground">{step}/7</span>
          <h4 className="text-sm font-medium">{title}</h4>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        {txHash && (
          <a
            href={getExplorerUrl(chainId, txHash, 'tx')}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] font-mono text-primary hover:underline mt-1"
          >
            {txHash.slice(0, 10)}...{txHash.slice(-8)}
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
        {contractAddress && (
          <a
            href={getExplorerUrl(chainId, contractAddress, 'address')}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-[10px] font-mono text-success hover:underline mt-0.5"
          >
            → {contractAddress.slice(0, 10)}...{contractAddress.slice(-8)}
          </a>
        )}
      </div>
    </div>
  );
}
