import { useAccount } from 'wagmi';
import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Hexagon, Rocket, PenTool, LayoutDashboard, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { PrivyConnectButton } from '@/components/privy/PrivyConnectButton';

const features = [
  {
    icon: Rocket,
    title: 'Deploy EVVM',
    description: 'Deploy 5 smart contracts to create a complete virtual blockchain on Tempo Testnet (Moderato)',
    to: '/deploy',
  },
  {
    icon: PenTool,
    title: 'Sign Transactions',
    description: 'Generate EIP-191 signatures for pay, dispersePay, and staking operations',
    to: '/signatures',
  },
  {
    icon: LayoutDashboard,
    title: 'Dashboard',
    description: 'Track and manage all your EVVM deployments with full manifest export',
    to: '/dashboard',
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
          Deploy Your Virtual
          <br />
          <span className="text-gradient-primary">Blockchain Instance</span>
        </h1>

        <p className="text-muted-foreground max-w-md mx-auto mb-8 text-sm md:text-base">
          Infraless EVM virtualization. Deploy EVVM contracts, generate EIP-191 signatures,
          and manage your virtual blockchain — all from your browser.
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
