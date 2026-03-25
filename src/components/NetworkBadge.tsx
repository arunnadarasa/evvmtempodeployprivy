import { cn } from '@/lib/utils';

interface NetworkBadgeProps {
  chainId: number;
  className?: string;
}

const chainMeta: Record<number, { name: string; color: string }> = {
  42431: { name: 'Tempo Testnet (Moderato)', color: 'bg-primary/20 text-primary border-primary/30' },
  84532: { name: 'Base Sepolia', color: 'bg-primary/20 text-primary border-primary/30' },
  11155111: { name: 'Sepolia', color: 'bg-muted text-muted-foreground border-border' },
};

export function NetworkBadge({ chainId, className }: NetworkBadgeProps) {
  const meta = chainMeta[chainId] || { name: 'Unknown', color: 'bg-muted text-muted-foreground border-border' };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider',
        meta.color,
        className
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {meta.name}
    </span>
  );
}
