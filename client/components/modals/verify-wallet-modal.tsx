"use client";

import { useState, useEffect } from "react";
import { X, Wallet, CheckCircle, AlertCircle, ExternalLink } from "lucide-react";
import {
  isFreighterInstalled,
  verifyWalletOwnership,
  StellarWalletError,
} from "@/lib/stellar-wallet";
import { apiPost } from "@/lib/api";
import { isTorBrowser, getTorCompatibilityInfo } from "@/lib/tor-detection";

interface VerifyWalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  onVerified: (publicKey: string) => void;
  darkMode?: boolean;
}

export default function VerifyWalletModal({
  isOpen,
  onClose,
  onVerified,
  darkMode,
}: VerifyWalletModalProps) {
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"connect" | "sign" | "verify" | "success">("connect");
  const [torInfo, setTorInfo] = useState({ isTorBrowser: false, knownLimitations: [] as string[] });

  // Detect Tor Browser on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const info = getTorCompatibilityInfo();
      setTorInfo({
        isTorBrowser: info.isTorBrowser,
        knownLimitations: info.knownLimitations,
      });
    }
  }, []);

  if (!isOpen) return null;

  const handleVerifyWallet = async () => {
    setIsVerifying(true);
    setError(null);

    try {
      // Check if Freighter is installed
      if (!isFreighterInstalled()) {
        const torBrowserNote = torInfo.isTorBrowser 
          ? "\n\nFreighter extensions often don't work in Tor Browser. Consider using a regular Firefox or Chrome browser, or contact support for alternative payment methods."
          : "";
        setError("Freighter wallet extension is not installed" + torBrowserNote);
        return;
      }

      // Step 1: Connect and sign
      setStep("sign");
      const { publicKey, message, signature } = await verifyWalletOwnership();

      // Step 2: Verify with backend
      setStep("verify");
      const response = await apiPost("/api/wallet/verify", {
        publicKey,
        message,
        signature,
      });

      if (response.verified) {
        setStep("success");
        setTimeout(() => {
          onVerified(publicKey);
          onClose();
        }, 2000);
      } else {
        throw new Error("Wallet verification failed");
      }
    } catch (err) {
      if (err instanceof StellarWalletError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(String(err) || 'An unexpected error occurred');
      }
      setStep("connect");
    } finally {
      setIsVerifying(false);
    }
  };

  const handleInstallFreighter = () => {
    window.open("https://www.freighter.app/", "_blank");
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div
        className={`${darkMode ? "bg-gray-900" : "bg-white"} rounded-xl p-6 max-w-md w-full`}
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#007A5C] flex items-center justify-center">
              <Wallet className="w-5 h-5 text-white" />
            </div>
            <h3 className={`text-xl font-bold ${darkMode ? "text-white" : "text-gray-900"}`}>
              Verify Stellar Wallet
            </h3>
          </div>
          <button
            onClick={onClose}
            disabled={isVerifying}
            aria-label="Close wallet verification modal"
            title="Close"
            className={`p-2 rounded-lg transition-colors ${
              darkMode ? "hover:bg-gray-800" : "hover:bg-gray-100"
            }`}
          >
            <X className={`w-5 h-5 ${darkMode ? "text-gray-400" : "text-gray-600"}`} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Tor Browser Warning */}
          {torInfo.isTorBrowser && (
            <div className="flex items-start gap-3 p-4 rounded-lg bg-yellow-50 border border-yellow-200">
              <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-yellow-800">Tor Browser Detected</p>
                <p className="text-sm text-yellow-700 mt-1">
                  {torInfo.knownLimitations.includes('Freighter wallet extension is not available in Tor Browser')
                    ? "The Freighter wallet extension may not work in Tor Browser due to extension restrictions. You can still use other methods to connect."
                    : "Some features may have limitations in Tor Browser."}
                </p>
              </div>
            </div>
          )}

          {/* Instructions */}
          <div
            className={`p-4 rounded-lg ${darkMode ? "bg-gray-800" : "bg-gray-50"}`}
          >
            <p className={`text-sm ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
              Connect your Stellar wallet using Freighter to prove ownership of your public
              address. This is a non-custodial process - we never have access to your private
              keys.
            </p>
          </div>

          {/* Status Steps */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  step === "connect"
                    ? "bg-[#007A5C] text-white"
                    : step === "sign" || step === "verify" || step === "success"
                      ? "bg-green-500 text-white"
                      : darkMode
                        ? "bg-gray-800 text-gray-400"
                        : "bg-gray-200 text-gray-600"
                }`}
              >
                {step === "sign" || step === "verify" || step === "success" ? (
                  <CheckCircle className="w-5 h-5" />
                ) : (
                  "1"
                )}
              </div>
              <span className={darkMode ? "text-gray-300" : "text-gray-700"}>
                Connect Freighter Wallet
              </span>
            </div>

            <div className="flex items-center gap-3">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  step === "sign"
                    ? "bg-[#007A5C] text-white"
                    : step === "verify" || step === "success"
                      ? "bg-green-500 text-white"
                      : darkMode
                        ? "bg-gray-800 text-gray-400"
                        : "bg-gray-200 text-gray-600"
                }`}
              >
                {step === "verify" || step === "success" ? (
                  <CheckCircle className="w-5 h-5" />
                ) : (
                  "2"
                )}
              </div>
              <span className={darkMode ? "text-gray-300" : "text-gray-700"}>
                Sign Verification Message
              </span>
            </div>

            <div className="flex items-center gap-3">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  step === "verify"
                    ? "bg-[#007A5C] text-white"
                    : step === "success"
                      ? "bg-green-500 text-white"
                      : darkMode
                        ? "bg-gray-800 text-gray-400"
                        : "bg-gray-200 text-gray-600"
                }`}
              >
                {step === "success" ? <CheckCircle className="w-5 h-5" /> : "3"}
              </div>
              <span className={darkMode ? "text-gray-300" : "text-gray-700"}>
                Verify Signature
              </span>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="flex items-start gap-3 p-4 rounded-lg bg-red-50 border border-red-200">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-red-800">{error}</p>
                {error.includes("not installed") && (
                  <button
                    onClick={handleInstallFreighter}
                    className="mt-2 text-sm font-medium text-red-600 hover:text-red-700 flex items-center gap-1"
                  >
                    Install Freighter <ExternalLink className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Success Message */}
          {step === "success" && (
            <div className="flex items-start gap-3 p-4 rounded-lg bg-green-50 border border-green-200">
              <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-green-800">Wallet Verified!</p>
                <p className="text-sm text-green-700 mt-1">
                  Your Stellar wallet has been successfully verified.
                </p>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4">
            <button
              onClick={onClose}
              disabled={isVerifying}
              className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                darkMode
                  ? "bg-gray-800 text-gray-300 hover:bg-gray-700"
                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              Cancel
            </button>
            <button
              onClick={handleVerifyWallet}
              disabled={isVerifying || step === "success"}
              className="flex-1 px-4 py-2 rounded-lg font-medium bg-[#007A5C] text-white hover:bg-[#007A5C]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isVerifying
                ? step === "sign"
                  ? "Signing..."
                  : step === "verify"
                    ? "Verifying..."
                    : "Connecting..."
                : step === "success"
                  ? "Verified"
                  : "Verify Wallet"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
