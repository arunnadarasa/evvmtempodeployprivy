import { useState } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { motion } from 'framer-motion';
import {
  buildMessageSignedForPay,
  buildMessageSignedForDispersePay,
  buildMessageSignedForPublicStaking,
  hashDispersePaymentUsersToPay,
  type DispersePayMetadata,
} from '@evvm/viem-signature-library';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Check, Copy, PenTool } from 'lucide-react';
import { PrivyConnectButton } from '@/components/privy/PrivyConnectButton';

const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as `0x${string}`;

function generateRandomNonce(): string {
  const array = new Uint8Array(8);
  crypto.getRandomValues(array);
  return BigInt('0x' + Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('')).toString();
}

export default function Signatures() {
  const { isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();

  const [signature, setSignature] = useState('');
  const [message, setMessage] = useState('');
  const [signing, setSigning] = useState(false);
  const [copied, setCopied] = useState(false);

  // Pay form
  const [payEvvmId, setPayEvvmId] = useState('1');
  const [payTo, setPayTo] = useState('');
  const [payToken, setPayToken] = useState<string>(ZERO_ADDR);
  const [payAmount, setPayAmount] = useState('');
  const [payPriorityFee, setPayPriorityFee] = useState('0');
  const [payNonce, setPayNonce] = useState(generateRandomNonce());
  const [payAsync, setPayAsync] = useState(false);

  // Disperse form
  const [disperseEvvmId, setDisperseEvvmId] = useState('1');
  const [disperseToken, setDisperseToken] = useState<string>(ZERO_ADDR);
  const [disperseRecipients, setDisperseRecipients] = useState('');
  const [disperseTotalAmount, setDisperseTotalAmount] = useState('');
  const [dispersePriorityFee, setDispersePriorityFee] = useState('0');
  const [disperseNonce, setDisperseNonce] = useState(generateRandomNonce());

  // Staking form
  const [stakingEvvmId, setStakingEvvmId] = useState('1');
  const [stakingIsStake, setStakingIsStake] = useState(true);
  const [stakingAmount, setStakingAmount] = useState('');
  const [stakingNonce, setStakingNonce] = useState(generateRandomNonce());

  const handleCopy = () => {
    navigator.clipboard.writeText(signature);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const signPay = async () => {
    if (!walletClient) return;
    setSigning(true);
    try {
      const msg = buildMessageSignedForPay(
        BigInt(payEvvmId),
        payTo as `0x${string}`,
        payToken as `0x${string}`,
        BigInt(payAmount || '0'),
        BigInt(payPriorityFee || '0'),
        BigInt(payNonce),
        payAsync,
        ZERO_ADDR
      );
      setMessage(msg);
      const sig = await walletClient.signMessage({
        message: msg,
        account: walletClient.account!,
      });
      setSignature(sig);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setSignature(`Error: ${msg}`);
    }
    setSigning(false);
  };

  const signDisperse = async () => {
    if (!walletClient) return;
    setSigning(true);
    try {
      // Parse recipients: "address:amount" per line
      const lines = disperseRecipients.split('\n').filter(Boolean);
      const toData: DispersePayMetadata[] = lines.map((line) => {
        const [addr, amt] = line.split(':').map((s) => s.trim());
        return {
          to_address: addr as `0x${string}`,
          to_identity: '',
          amount: BigInt(amt || '0'),
        };
      });

      const hashedData = hashDispersePaymentUsersToPay(toData);
      const msg = buildMessageSignedForDispersePay(
        BigInt(disperseEvvmId),
        hashedData.slice(2),
        disperseToken as `0x${string}`,
        BigInt(disperseTotalAmount || '0'),
        BigInt(dispersePriorityFee || '0'),
        BigInt(disperseNonce),
        false,
        ZERO_ADDR
      );
      setMessage(msg);
      const sig = await walletClient.signMessage({
        message: msg,
        account: walletClient.account!,
      });
      setSignature(sig);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setSignature(`Error: ${msg}`);
    }
    setSigning(false);
  };

  const signStaking = async () => {
    if (!walletClient) return;
    setSigning(true);
    try {
      const msg = buildMessageSignedForPublicStaking(
        BigInt(stakingEvvmId),
        stakingIsStake,
        BigInt(stakingAmount || '0'),
        BigInt(stakingNonce)
      );
      setMessage(msg);
      const sig = await walletClient.signMessage({
        message: msg,
        account: walletClient.account!,
      });
      setSignature(sig);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setSignature(`Error: ${msg}`);
    }
    setSigning(false);
  };

  if (!isConnected) {
    return (
      <main className="container max-w-lg px-4 py-16 text-center">
        <PenTool className="h-8 w-8 text-primary mx-auto mb-4" />
        <h1 className="text-xl font-bold mb-2">Connect Wallet to Sign</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Connect your wallet to generate EIP-191 signatures for EVVM operations.
        </p>
        <div className="flex justify-center">
          <PrivyConnectButton size="default" />
        </div>
      </main>
    );
  }

  return (
    <main className="container max-w-2xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-lg font-bold">Signature Builder</h1>
        <p className="text-xs text-muted-foreground">Generate EIP-191 signed messages for EVVM operations</p>
      </div>

      <Tabs defaultValue="pay" className="space-y-4">
        <TabsList className="w-full">
          <TabsTrigger value="pay" className="flex-1 text-xs">Pay</TabsTrigger>
          <TabsTrigger value="disperse" className="flex-1 text-xs">DispersePay</TabsTrigger>
          <TabsTrigger value="staking" className="flex-1 text-xs">Staking</TabsTrigger>
        </TabsList>

        {/* Pay Tab */}
        <TabsContent value="pay">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Single Payment Signature</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[10px]">EVVM ID</Label>
                  <Input value={payEvvmId} onChange={(e) => setPayEvvmId(e.target.value)} className="mt-0.5 h-8 text-xs font-mono" />
                </div>
                <div>
                  <Label className="text-[10px]">Nonce</Label>
                  <Input value={payNonce} onChange={(e) => setPayNonce(e.target.value)} className="mt-0.5 h-8 text-xs font-mono" />
                </div>
              </div>
              <div>
                <Label className="text-[10px]">Recipient Address</Label>
                <Input value={payTo} onChange={(e) => setPayTo(e.target.value)} placeholder="0x..." className="mt-0.5 h-8 text-xs font-mono" />
              </div>
              <div>
                <Label className="text-[10px]">Token Address</Label>
                <Input value={payToken} onChange={(e) => setPayToken(e.target.value)} className="mt-0.5 h-8 text-xs font-mono" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[10px]">Amount (wei)</Label>
                  <Input value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="0" className="mt-0.5 h-8 text-xs font-mono" />
                </div>
                <div>
                  <Label className="text-[10px]">Priority Fee (wei)</Label>
                  <Input value={payPriorityFee} onChange={(e) => setPayPriorityFee(e.target.value)} className="mt-0.5 h-8 text-xs font-mono" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={payAsync}
                  onChange={(e) => setPayAsync(e.target.checked)}
                  className="rounded border-border"
                  id="pay-async"
                />
                <Label htmlFor="pay-async" className="text-[10px]">Async Nonce (parallel execution)</Label>
              </div>
              <Button onClick={signPay} disabled={signing || !payTo} className="w-full h-8 text-xs">
                <PenTool className="h-3 w-3" /> Sign Payment
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* DispersePay Tab */}
        <TabsContent value="disperse">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Disperse Payment Signature</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[10px]">EVVM ID</Label>
                  <Input value={disperseEvvmId} onChange={(e) => setDisperseEvvmId(e.target.value)} className="mt-0.5 h-8 text-xs font-mono" />
                </div>
                <div>
                  <Label className="text-[10px]">Nonce</Label>
                  <Input value={disperseNonce} onChange={(e) => setDisperseNonce(e.target.value)} className="mt-0.5 h-8 text-xs font-mono" />
                </div>
              </div>
              <div>
                <Label className="text-[10px]">Token Address</Label>
                <Input value={disperseToken} onChange={(e) => setDisperseToken(e.target.value)} className="mt-0.5 h-8 text-xs font-mono" />
              </div>
              <div>
                <Label className="text-[10px]">Recipients (one per line: address:amount)</Label>
                <textarea
                  value={disperseRecipients}
                  onChange={(e) => setDisperseRecipients(e.target.value)}
                  placeholder={"0x742c...d8c:50000000000000000\n0xabc1...def:30000000000000000"}
                  rows={4}
                  className="mt-0.5 w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[10px]">Total Amount (wei)</Label>
                  <Input value={disperseTotalAmount} onChange={(e) => setDisperseTotalAmount(e.target.value)} className="mt-0.5 h-8 text-xs font-mono" />
                </div>
                <div>
                  <Label className="text-[10px]">Priority Fee (wei)</Label>
                  <Input value={dispersePriorityFee} onChange={(e) => setDispersePriorityFee(e.target.value)} className="mt-0.5 h-8 text-xs font-mono" />
                </div>
              </div>
              <Button onClick={signDisperse} disabled={signing || !disperseRecipients} className="w-full h-8 text-xs">
                <PenTool className="h-3 w-3" /> Sign Disperse Payment
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Staking Tab */}
        <TabsContent value="staking">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Public Staking Signature</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[10px]">EVVM ID</Label>
                  <Input value={stakingEvvmId} onChange={(e) => setStakingEvvmId(e.target.value)} className="mt-0.5 h-8 text-xs font-mono" />
                </div>
                <div>
                  <Label className="text-[10px]">Nonce</Label>
                  <Input value={stakingNonce} onChange={(e) => setStakingNonce(e.target.value)} className="mt-0.5 h-8 text-xs font-mono" />
                </div>
              </div>
              <div>
                <Label className="text-[10px]">Amount of sMate</Label>
                <Input value={stakingAmount} onChange={(e) => setStakingAmount(e.target.value)} placeholder="0" className="mt-0.5 h-8 text-xs font-mono" />
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={stakingIsStake} onChange={() => setStakingIsStake(true)} className="text-primary" />
                  <span className="text-xs">Stake</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={!stakingIsStake} onChange={() => setStakingIsStake(false)} className="text-primary" />
                  <span className="text-xs">Unstake</span>
                </label>
              </div>
              <Button onClick={signStaking} disabled={signing || !stakingAmount} className="w-full h-8 text-xs">
                <PenTool className="h-3 w-3" /> Sign Staking
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Signature Output */}
      {(signature || message) && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4"
        >
          <Card>
            <CardContent className="pt-4 space-y-3">
              {message && (
                <div>
                  <Label className="text-[10px] text-muted-foreground">Message</Label>
                  <div className="mt-1 rounded-md bg-muted/50 border border-border p-2 text-[10px] font-mono break-all text-muted-foreground max-h-20 overflow-auto">
                    {message}
                  </div>
                </div>
              )}
              {signature && !signature.startsWith('Error') && (
                <div>
                  <div className="flex items-center justify-between">
                    <Label className="text-[10px] text-muted-foreground">Signature</Label>
                    <Button variant="ghost" size="sm" className="h-5 text-[10px] px-2" onClick={handleCopy}>
                      {copied ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
                    </Button>
                  </div>
                  <div className="mt-1 rounded-md bg-primary/5 border border-primary/20 p-2 text-[10px] font-mono break-all text-primary">
                    {signature}
                  </div>
                </div>
              )}
              {signature.startsWith('Error') && (
                <div className="rounded-md bg-destructive/5 border border-destructive/20 p-2 text-[10px] text-destructive">
                  {signature}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}
    </main>
  );
}
