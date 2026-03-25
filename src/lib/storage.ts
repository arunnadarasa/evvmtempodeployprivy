export interface DeploymentRecord {
  id: string;
  createdAt: string;
  evvmName: string;
  principalTokenName: string;
  principalTokenSymbol: string;
  hostChainId: number;
  hostChainName: string;
  adminAddress: string;
  goldenFisherAddress: string;
  activatorAddress: string;
  stakingAddress?: string;
  evvmCoreAddress?: string;
  nameServiceAddress?: string;
  estimatorAddress?: string;
  treasuryAddress?: string;
  p2pSwapAddress?: string;
  deploymentStatus: 'pending' | 'deploying' | 'setup' | 'registering' | 'completed' | 'failed';
  currentStep: number;
  txHashes: Record<string, string>;
  evvmId?: number;
  totalSupply: string;
  eraTokens: string;
  rewardPerOperation: string;
}

const STORAGE_KEY = 'evvm_deployments';

export function getDeployments(): DeploymentRecord[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function saveDeployment(deployment: DeploymentRecord): void {
  const deployments = getDeployments();
  const idx = deployments.findIndex((d) => d.id === deployment.id);
  if (idx >= 0) {
    deployments[idx] = deployment;
  } else {
    deployments.unshift(deployment);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(deployments));
}

export function saveDeployments(deployments: DeploymentRecord[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(deployments));
}

export function getDeployment(id: string): DeploymentRecord | undefined {
  return getDeployments().find((d) => d.id === id);
}

export function deleteDeployment(id: string): void {
  const deployments = getDeployments().filter((d) => d.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(deployments));
}

export function exportDeploymentJSON(deployment: DeploymentRecord): string {
  return JSON.stringify(deployment, null, 2);
}

export function generateId(): string {
  return crypto.randomUUID();
}
