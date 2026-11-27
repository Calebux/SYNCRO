'use client';

import { useState, useEffect } from 'react';
import { stellarWallet, WalletInfo } from '../lib/stellar-wallet';

export function useWallet() {
  const [wallet, setWallet] = useState<WalletInfo | null>(stellarWallet.getWallet());
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubConnect = stellarWallet.on('walletConnected', (info) => {
      setWallet(info || null);
      setError(null);
    });

    const unsubDisconnect = stellarWallet.on('walletDisconnected', () => {
      setWallet(null);
      setError(null);
    });

    const unsubChange = stellarWallet.on('walletChanged', (newInfo, oldInfo) => {
      setWallet(newInfo || null);
      setError(null);
    });

    return () => {
      unsubConnect();
      unsubDisconnect();
      unsubChange();
    };
  }, []);

  const connect = async (network: 'testnet' | 'mainnet' = 'testnet') => {
    setIsConnecting(true);
    setError(null);
    try {
      const info = await stellarWallet.connect(network);
      setWallet(info);
      return info;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect wallet';
      setError(message);
      throw err;
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnect = () => {
    stellarWallet.disconnect();
    setWallet(null);
  };

  const signTransaction = async (xdr: string) => {
    try {
      return await stellarWallet.signTransaction(xdr);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to sign transaction';
      setError(message);
      throw err;
    }
  };

  return {
    wallet,
    isConnected: wallet !== null,
    isConnecting,
    error,
    connect,
    disconnect,
    signTransaction,
  };
}
