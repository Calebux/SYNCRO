'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/hooks/use-wallet';
import { keyRotationClient } from '@/lib/key-rotation-client';
import type { KeyRotationProgress } from '@/lib/key-rotation-client';

export default function WalletSettingsPage() {
  const router = useRouter();
  const { wallet, isConnected, connect, disconnect } = useWallet();
  const [isChangingWallet, setIsChangingWallet] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [oldWalletKey, setOldWalletKey] = useState<string | null>(null);
  const [rotationProgress, setRotationProgress] = useState<KeyRotationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReEncrypting, setIsReEncrypting] = useState(false);

  // Check for ongoing rotation on mount
  useEffect(() => {
    checkRotationStatus();
  }, []);

  const checkRotationStatus = async () => {
    const progress = await keyRotationClient.getRotationProgress();
    if (progress.inProgress) {
      setRotationProgress(progress);
      setIsReEncrypting(true);
    }
  };

  const handleChangeWallet = () => {
    if (!wallet) return;
    setOldWalletKey(wallet.publicKey);
    setShowWarning(true);
  };

  const handleConfirmChange = async () => {
    setShowWarning(false);
    setIsChangingWallet(true);
    setError(null);

    try {
      // Disconnect current wallet
      disconnect();

      // Connect new wallet
      const newWallet = await connect(wallet?.network || 'testnet');

      // Check if wallet actually changed
      if (oldWalletKey === newWallet.publicKey) {
        setError('You connected the same wallet. Please connect a different wallet.');
        setIsChangingWallet(false);
        return;
      }

      // Initiate key rotation
      const result = await keyRotationClient.initiateKeyRotation(oldWalletKey!, newWallet.publicKey);

      if (!result.success) {
        setError(result.error || 'Failed to initiate key rotation');
        setIsChangingWallet(false);
        return;
      }

      if (result.totalSubscriptions === 0) {
        // No subscriptions to re-encrypt, complete immediately
        const completeResult = await keyRotationClient.completeKeyRotation(newWallet.publicKey);
        if (completeResult.success) {
          setIsChangingWallet(false);
          alert('Wallet changed successfully!');
        } else {
          setError(completeResult.error || 'Failed to complete key rotation');
          setIsChangingWallet(false);
        }
        return;
      }

      // Start re-encryption process
      setIsReEncrypting(true);
      setRotationProgress({
        inProgress: true,
        totalSubscriptions: result.totalSubscriptions,
        completedSubscriptions: 0,
        failedSubscriptions: 0,
        percentComplete: 0,
      });

      const reEncryptResult = await keyRotationClient.performReEncryption(
        oldWalletKey!,
        newWallet.publicKey,
        (completed, total) => {
          setRotationProgress({
            inProgress: true,
            totalSubscriptions: total,
            completedSubscriptions: completed,
            failedSubscriptions: 0,
            percentComplete: Math.round((completed / total) * 100),
          });
        }
      );

      if (!reEncryptResult.success) {
        setError(reEncryptResult.error || 'Re-encryption failed');
        setIsReEncrypting(false);
        setIsChangingWallet(false);
        return;
      }

      // Complete key rotation
      const completeResult = await keyRotationClient.completeKeyRotation(newWallet.publicKey);

      if (!completeResult.success) {
        setError(completeResult.error || 'Failed to complete key rotation');
        setIsReEncrypting(false);
        setIsChangingWallet(false);
        return;
      }

      // Success!
      setIsReEncrypting(false);
      setIsChangingWallet(false);
      setRotationProgress(null);
      alert('Wallet changed and all data re-encrypted successfully!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setIsChangingWallet(false);
      setIsReEncrypting(false);
    }
  };

  const handleCancelChange = () => {
    setShowWarning(false);
    setOldWalletKey(null);
  };

  const handleCancelRotation = async () => {
    const result = await keyRotationClient.cancelKeyRotation();
    if (result.success) {
      setIsReEncrypting(false);
      setRotationProgress(null);
      setIsChangingWallet(false);
      alert('Key rotation canceled');
    } else {
      setError(result.error || 'Failed to cancel rotation');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 sm:px-8 py-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/settings')}
            className="text-gray-600 hover:text-gray-900"
            aria-label="Back to settings"
          >
            ← Back
          </button>
          <h1 className="text-xl font-bold text-gray-900">Wallet Management</h1>
        </div>
      </header>

      <main className="px-4 sm:px-8 py-6 space-y-6 max-w-2xl">
        {/* Current Wallet Status */}
        <section className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Connected Wallet</h2>
          
          {isConnected && wallet ? (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-600 mb-1">Public Key</p>
                <p className="font-mono text-sm bg-gray-50 p-2 rounded break-all">
                  {wallet.publicKey}
                </p>
              </div>
              
              <div>
                <p className="text-sm text-gray-600 mb-1">Network</p>
                <p className="text-sm font-medium capitalize">{wallet.network}</p>
              </div>

              <button
                onClick={handleChangeWallet}
                disabled={isChangingWallet || isReEncrypting}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {isChangingWallet ? 'Changing Wallet...' : 'Change Wallet'}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-gray-600">No wallet connected</p>
              <button
                onClick={() => connect()}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Connect Wallet
              </button>
            </div>
          )}
        </section>

        {/* Re-encryption Progress */}
        {isReEncrypting && rotationProgress && (
          <section className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Re-encrypting Data</h2>
            
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Re-encrypting your subscription data with the new wallet's encryption key...
              </p>

              {/* Progress Bar */}
              <div className="w-full bg-gray-200 rounded-full h-4">
                <div
                  className="bg-blue-600 h-4 rounded-full transition-all duration-300"
                  style={{ width: `${rotationProgress.percentComplete}%` }}
                />
              </div>

              <div className="flex justify-between text-sm text-gray-600">
                <span>
                  {rotationProgress.completedSubscriptions} of {rotationProgress.totalSubscriptions} subscriptions
                </span>
                <span>{rotationProgress.percentComplete}%</span>
              </div>

              {rotationProgress.failedSubscriptions > 0 && (
                <p className="text-sm text-red-600">
                  {rotationProgress.failedSubscriptions} subscriptions failed to re-encrypt
                </p>
              )}

              <button
                onClick={handleCancelRotation}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
              >
                Cancel Rotation
              </button>
            </div>
          </section>
        )}

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800 text-sm">{error}</p>
          </div>
        )}

        {/* Warning Modal */}
        {showWarning && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md mx-4">
              <h3 className="text-lg font-bold text-gray-900 mb-4">
                ⚠️ Warning: Wallet Change Requires Re-encryption
              </h3>
              
              <div className="space-y-4 mb-6">
                <p className="text-sm text-gray-700">
                  Changing your wallet will trigger a re-encryption process for all your encrypted subscription data.
                </p>

                <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
                  <p className="text-sm text-yellow-800 font-semibold mb-2">
                    Important:
                  </p>
                  <ul className="text-sm text-yellow-800 list-disc list-inside space-y-1">
                    <li>All encrypted data will be re-encrypted with your new wallet's key</li>
                    <li>This process cannot be interrupted once started</li>
                    <li>If you lose access to your old wallet before this process completes, your encrypted data may be lost</li>
                    <li>Make sure you have access to both wallets during this process</li>
                  </ul>
                </div>

                <p className="text-sm text-gray-700">
                  Do you want to continue?
                </p>
              </div>

              <div className="flex gap-3 justify-end">
                <button
                  onClick={handleCancelChange}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmChange}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Information Section */}
        <section className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-blue-900 mb-4">About Wallet-Based Encryption</h2>
          
          <div className="space-y-3 text-sm text-blue-800">
            <p>
              Your subscription data is encrypted using a key derived from your Stellar wallet's public key using HKDF-SHA256.
            </p>
            <p>
              This means:
            </p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>Your encryption key is deterministically derived from your wallet</li>
              <li>Only you can decrypt your data (self-custodial)</li>
              <li>If you change wallets, data must be re-encrypted</li>
              <li>Loss of wallet access means loss of encrypted data</li>
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
}
