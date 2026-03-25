import { useLogin, usePrivy } from '@privy-io/react-auth';
import { Button } from '@/components/ui/button';

function formatAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function PrivyConnectButton({ size = 'sm' }: { size?: 'sm' | 'default' }) {
  const { ready, authenticated, user, logout } = usePrivy();
  const { login } = useLogin();
  const primaryWallet = user?.wallet?.address;

  if (!ready) {
    return (
      <Button variant="secondary" size={size} disabled>
        Loading…
      </Button>
    );
  }

  if (!authenticated) {
    return (
      <Button size={size} onClick={login} className="glow-primary">
        Log in
      </Button>
    );
  }

  return (
    <Button variant="secondary" size={size} onClick={logout}>
      {primaryWallet ? formatAddr(primaryWallet) : 'Account'} • Log out
    </Button>
  );
}
