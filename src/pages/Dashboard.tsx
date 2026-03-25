import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getDeployments, deleteDeployment, type DeploymentRecord } from '@/lib/storage';
import { ManifestCard } from '@/components/ManifestCard';
import { NetworkBadge } from '@/components/NetworkBadge';
import { Button } from '@/components/ui/button';
import { LayoutDashboard, Trash2, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Dashboard() {
  const [deployments, setDeployments] = useState<DeploymentRecord[]>([]);

  const refresh = () => setDeployments(getDeployments());

  useEffect(() => {
    refresh();
  }, []);

  const handleDelete = (id: string) => {
    deleteDeployment(id);
    refresh();
  };

  if (deployments.length === 0) {
    return (
      <main className="container max-w-lg px-4 py-16 text-center">
        <LayoutDashboard className="h-8 w-8 text-muted-foreground mx-auto mb-4" />
        <h1 className="text-xl font-bold mb-2">No Deployments Yet</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Deploy your first EVVM instance to see it here.
        </p>
        <Button asChild>
          <Link to="/deploy">Deploy Now</Link>
        </Button>
      </main>
    );
  }

  return (
    <main className="container max-w-screen-lg px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold">Deployments</h1>
          <p className="text-xs text-muted-foreground">{deployments.length} instance{deployments.length !== 1 ? 's' : ''}</p>
        </div>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={refresh}>
          <RefreshCw className="h-3 w-3" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <AnimatePresence>
          {deployments.map((d) => (
            <motion.div
              key={d.id}
              layout
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <NetworkBadge chainId={d.hostChainId} />
                    <span className={`text-[10px] font-medium uppercase tracking-wider ${
                      d.deploymentStatus === 'completed' ? 'text-success' :
                      d.deploymentStatus === 'failed' ? 'text-destructive' :
                      'text-warning'
                    }`}>
                      {d.deploymentStatus}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(d.createdAt).toLocaleDateString()}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(d.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <ManifestCard deployment={d} />
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </main>
  );
}
