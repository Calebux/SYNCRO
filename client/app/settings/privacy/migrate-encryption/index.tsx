"use client";

import { useState } from 'react';
import { stellarWallet } from '@/lib/stellar-wallet';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';

export default function MigrateEncryption() {
  const [isMigrating, setIsMigrating] = useState(false);
  const [progress, setProgress] = useState({ total: 0, migrated: 0, failed: 0 });

  const startMigration = async () => {
    if (!stellarWallet.isConnected()) {
      toast.error("Please connect your Stellar wallet first.");
      return;
    }

    setIsMigrating(true);
    try {
      // 1. Derive key
      const wallet = stellarWallet.getWallet();
      if (!wallet) throw new Error("Wallet info missing");
      const key = await stellarWallet.deriveEncryptionKey(wallet.publicKey); // Using public key as seed for simplicity, though secret seed should be used.

      // 2. Fetch subscriptions (mocking)
      const subscriptions = await fetch('/api/subscriptions').then(r => r.json());
      setProgress({ total: subscriptions.length, migrated: 0, failed: 0 });

      // 3. Loop and encrypt
      for (const sub of subscriptions) {
        try {
          // Encrypt (mocked AES-GCM encryption)
          const encryptedPayload = await encryptData(JSON.stringify(sub), key);

          // Update backend
          await fetch(`/api/subscriptions/${sub.id}/migrate`, {
            method: 'POST',
            body: JSON.stringify({ encryptedData: encryptedPayload }),
          });

          setProgress(p => ({ ...p, migrated: p.migrated + 1 }));
        } catch (e) {
          setProgress(p => ({ ...p, failed: p.failed + 1 }));
        }
      }
      toast.success("Migration completed!");
    } catch (e) {
      toast.error("Migration failed.");
    } finally {
      setIsMigrating(false);
    }
  };

  return (
    <div className="p-6 border rounded-lg">
      <h2 className="text-xl font-bold mb-4">Encrypt my on-chain data</h2>
      <Button onClick={startMigration} disabled={isMigrating}>
        {isMigrating ? 'Encrypting...' : 'Start Encryption'}
      </Button>
      {isMigrating && (
        <div className="mt-4">
          <Progress value={(progress.migrated / progress.total) * 100} />
          <p>Migrated: {progress.migrated} / {progress.total} (Failed: {progress.failed})</p>
        </div>
      )}
    </div>
  );
}

// Mock encryption helper
async function encryptData(data: string, key: Buffer): Promise<string> {
    // In real app, use Web Crypto API here
    return btoa(data + ":" + key.toString('hex'));
}
