import { cn } from '@/lib/utils';
import { Check, Loader2, X } from 'lucide-react';

export type StepStatus = 'pending' | 'active' | 'completed' | 'failed';

interface StatusCircleProps {
  status: StepStatus;
  size?: 'sm' | 'md';
}

export function StatusCircle({ status, size = 'md' }: StatusCircleProps) {
  const sizeClasses = size === 'sm' ? 'h-5 w-5' : 'h-6 w-6';
  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5';

  return (
    <div
      className={cn(
        'rounded-full flex items-center justify-center border-2 transition-all brand-curve',
        sizeClasses,
        status === 'pending' && 'border-muted-foreground/30 bg-transparent',
        status === 'active' && 'border-primary bg-primary/20 animate-pulse-glow',
        status === 'completed' && 'border-success bg-success',
        status === 'failed' && 'border-destructive bg-destructive'
      )}
    >
      {status === 'active' && <Loader2 className={cn(iconSize, 'text-primary animate-spin')} />}
      {status === 'completed' && <Check className={cn(iconSize, 'text-success-foreground')} />}
      {status === 'failed' && <X className={cn(iconSize, 'text-destructive-foreground')} />}
    </div>
  );
}
