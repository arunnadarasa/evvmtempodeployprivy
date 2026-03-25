import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Hexagon, Rocket, PenTool, LayoutDashboard, Orbit } from 'lucide-react';
import { PrivyConnectButton } from '@/components/privy/PrivyConnectButton';

const navItems = [
  { to: '/', label: 'Home', icon: Hexagon },
  { to: '/deploy', label: 'Deploy', icon: Rocket },
  { to: '/register', label: 'Register', icon: Orbit },
  { to: '/signatures', label: 'Signatures', icon: PenTool },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
];

export function Navbar() {
  const location = useLocation();

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="container flex h-14 max-w-screen-xl items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <Hexagon className="h-5 w-5 text-primary" />
            <span className="text-sm">EVVM <span className="text-muted-foreground font-normal">ichiban</span></span>
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  location.pathname === item.to
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                )}
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <PrivyConnectButton />
      </div>
    </header>
  );
}
