import { useAccount } from 'wagmi';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Hexagon, Rocket, PenTool, LayoutDashboard, ArrowRight, Wallet, Coins, BadgeDollarSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { PrivyConnectButton } from '@/components/privy/PrivyConnectButton';

const features = [
  {
    icon: Rocket,
    title: 'Deploy EVVM',
    description: 'Start the EVVM setup flow with your Privy social wallet and Tempo deployment tools.',
    to: '/deploy',
  },
  {
    icon: PenTool,
    title: 'Sign Transactions',
    description: 'Generate EIP-191 signatures for pay, dispersePay, and staking operations from your Privy wallet.',
    to: '/signatures',
  },
  {
    icon: LayoutDashboard,
    title: 'Dashboard',
    description: 'Track deployments, wallet addresses, and the next actions toward Sepolia registration.',
    to: '/dashboard',
  },
];

const journey = [
  {
    icon: Wallet,
    title: '1. Social Login',
    description: 'Use Privy email or Google login to create the embedded wallet that will hold test assets and authorizations.',
  },
  {
    icon: Coins,
    title: '2. Fund The Wallet',
    description: 'Top up the Privy wallet with Tempo gas and test assets such as PathUSD from a faucet or treasury path.',
  },
  {
    icon: BadgeDollarSign,
    title: '3. Use EVVM Operations',
    description: 'Make payment and staking signatures from the funded wallet while ZeroDev sponsorship is used where supported.',
  },
  {
    icon: Rocket,
    title: '4. Register Later',
    description: 'Treat Sepolia EVVM registration as the follow-on step once the instance and payment path are ready.',
  },
];

export default function Index() {
  const { isConnected } = useAccount();
  const navigate = useNavigate();

  return (
    <main className="container max-w-screen-lg px-4 py-12 md:py-20">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
        className="text-center mb-16"
      >
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 mb-6">
          <Hexagon className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-medium text-primary">EVVM Ichiban • Tempo Testnet (Moderato)</span>
        </div>

        <h1 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">
          Launch Your Social-Login
          <br />
          <span className="text-gradient-primary">EVVM Wallet Flow</span>
        </h1>

        <p className="text-muted-foreground max-w-2xl mx-auto mb-8 text-sm md:text-base">
          Keep Privy for social login, treat the embedded wallet as the account you fund, and use this app for
          EVVM deployment attempts, payment signatures, and the eventual Sepolia registration path.
        </p>

        {!isConnected ? (
          <div className="flex justify-center">
            <PrivyConnectButton size="default" />
          </div>
        ) : (
          <Button
            onClick={() => navigate('/deploy')}
            className="h-10 px-6 gap-2 glow-primary"
          >
            Start Deploying
            <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </motion.div>

      {/* Feature Cards */}
      <div className="grid md:grid-cols-3 gap-4">
        {features.map((feature, i) => (
          <motion.div
            key={feature.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 * (i + 1), ease: [0.2, 0.8, 0.2, 1] }}
          >
            <Link
              to={feature.to}
              className="group block rounded-md border border-border bg-card p-5 hover:border-primary/30 hover:bg-card/80 transition-all brand-curve"
            >
              <feature.icon className="h-5 w-5 text-primary mb-3" />
              <h3 className="text-sm font-semibold mb-1">{feature.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{feature.description}</p>
              <span className="inline-flex items-center gap-1 text-[10px] text-primary mt-3 group-hover:gap-2 transition-all">
                Open <ArrowRight className="h-3 w-3" />
              </span>
            </Link>
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35, duration: 0.5 }}
        className="mt-10 rounded-md border border-border bg-card/60 p-5"
      >
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Recommended Path</p>
          <h2 className="mt-2 text-lg font-semibold">Privy social wallet first, sponsorship where it works</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This keeps the product centered on social login instead of assuming every Tempo contract deployment can be sponsored end to end.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {journey.map((step) => (
            <div key={step.title} className="rounded-md border border-border/80 bg-background/50 p-4">
              <step.icon className="h-4 w-4 text-primary mb-2" />
              <h3 className="text-sm font-medium">{step.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.description}</p>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Tech Stack */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="mt-16 text-center"
      >
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">Powered by</p>
        <div className="flex items-center justify-center gap-6 text-xs text-muted-foreground">
          <span>EVVM v3</span>
          <span className="h-3 w-px bg-border" />
          <span>Tempo Testnet (Moderato)</span>
          <span className="h-3 w-px bg-border" />
          <span>EIP-191</span>
          <span className="h-3 w-px bg-border" />
          <span>wagmi + viem</span>
        </div>
      </motion.div>
    </main>
  );
}
