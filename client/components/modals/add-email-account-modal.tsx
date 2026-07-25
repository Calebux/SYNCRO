"use client";

import { useState } from "react";
import { apiPost } from "../../lib/api";
import { X, Mail, Building2, Server, Forward } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AddEmailAccountModalProps {
  onClose: () => void;
  onAdd: (account: any) => void;
  darkMode: boolean;
}

export function AddEmailAccountModal({
  onClose,
  onAdd,
  darkMode,
}: AddEmailAccountModalProps) {
  const [step, setStep] = useState<"provider" | "oauth" | "imap">("provider");
  const [provider, setProvider] = useState<
    "gmail" | "microsoft" | "imap" | "forward" | "yahoo" | "icloud"
  >("gmail");
  const [imapConfig, setImapConfig] = useState({
    email: "",
    password: "",
    host: "",
    port: "993",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleProviderSelect = (selectedProvider: typeof provider) => {
    setProvider(selectedProvider);
    
    // Set default host and port for Yahoo and iCloud
    if (selectedProvider === "yahoo") {
      setImapConfig(prev => ({
        ...prev,
        host: "imap.mail.yahoo.com",
        port: "993"
      }));
    } else if (selectedProvider === "icloud") {
      setImapConfig(prev => ({
        ...prev,
        host: "imap.mail.me.com",
        port: "993"
      }));
    }
    
    if (selectedProvider === "gmail" || selectedProvider === "microsoft") {
      setStep("oauth");
    } else if (selectedProvider === "imap" || selectedProvider === "yahoo" || selectedProvider === "icloud") {
      setStep("imap");
    } else {
      // Forward - show instructions
      setStep("provider");
    }
  };

  const handleOAuthConnect = async () => {
    setLoading(true);
    try {
      // Redirect to OAuth flow
      window.location.href = `/api/auth/${provider}`;
    } catch (err) {
      setError("Failed to initiate OAuth flow");
      setLoading(false);
    }
  };

  const handleImapConnect = async () => {
    setLoading(true);
    setError("");

    try {
      let data;
      if (provider === "yahoo") {
        data = await apiPost("/api/integrations/yahoo/connect", {
          email: imapConfig.email,
          password: imapConfig.password,
        });
      } else if (provider === "icloud") {
        data = await apiPost("/api/integrations/icloud/connect", {
          email: imapConfig.email,
          password: imapConfig.password,
        });
      } else {
        data = await apiPost("/api/email/connect-imap", {
          ...imapConfig,
          provider: "imap",
        });
      }

      // assume success if no error thrown
      onAdd({
        email: imapConfig.email,
        provider: provider === "yahoo" || provider === "icloud" ? provider : "imap",
        is_connected: true,
      });

      onClose();
    } catch (err) {
      console.error("Connect error:", err);
      setError(
        "Failed to connect to email server. Please check your credentials."
      );
    } finally {
      setLoading(false);
    }
  };

  const detectImapSettings = (email: string) => {
    const domain = email.split("@")[1];
    const presets: Record<string, { host: string; port: string }> = {
      "outlook.com": { host: "outlook.office365.com", port: "993" },
      "hotmail.com": { host: "outlook.office365.com", port: "993" },
      "yahoo.com": { host: "imap.mail.yahoo.com", port: "993" },
      "icloud.com": { host: "imap.mail.me.com", port: "993" },
      "aol.com": { host: "imap.aol.com", port: "993" },
      "zoho.com": { host: "imap.zoho.com", port: "993" },
    };

    if (presets[domain]) {
      setImapConfig((prev) => ({
        ...prev,
        host: presets[domain].host,
        port: presets[domain].port,
      }));
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div
        className={`${
          darkMode ? "bg-gray-800 text-white" : "bg-white text-gray-900"
        } rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto`}
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold">Connect Email Account</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          {step === "provider" && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                Connect your work email to automatically detect team
                subscriptions
              </p>

              <button
                onClick={() => handleProviderSelect("gmail")}
                className={`w-full p-4 rounded-lg border-2 ${
                  darkMode
                    ? "border-gray-700 hover:border-blue-500 bg-gray-750"
                    : "border-gray-200 hover:border-blue-500 bg-gray-50"
                } transition-colors text-left`}
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                    <Mail className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold mb-1">
                      Gmail / Google Workspace
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Connect your Gmail or Google Workspace account with OAuth
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-xs px-2 py-1 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                        Recommended
                      </span>
                      <span className="text-xs px-2 py-1 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
                        Secure OAuth
                      </span>
                    </div>
                  </div>
                </div>
              </button>

              <button
                onClick={() => handleProviderSelect("microsoft")}
                className={`w-full p-4 rounded-lg border-2 ${
                  darkMode
                    ? "border-gray-700 hover:border-blue-500 bg-gray-750"
                    : "border-gray-200 hover:border-blue-500 bg-gray-50"
                } transition-colors text-left`}
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold mb-1">
                      Microsoft 365 / Outlook
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Connect your work email with Microsoft OAuth
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-xs px-2 py-1 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                        Recommended for Enterprise
                      </span>
                      <span className="text-xs px-2 py-1 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
                        Secure OAuth
                      </span>
                    </div>
                  </div>
                </div>
              </button>

              <button
                onClick={() => handleProviderSelect("yahoo")}
                className={`w-full p-4 rounded-lg border-2 ${
                  darkMode
                    ? "border-gray-700 hover:border-blue-500 bg-gray-750"
                    : "border-gray-200 hover:border-blue-500 bg-gray-50"
                } transition-colors text-left`}
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0">
                    <Mail className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold mb-1">
                      Yahoo Mail
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Connect your Yahoo Mail account with app password
                    </p>
                    <div className="mt-2">
                      <span className="text-xs px-2 py-1 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400">
                        App Password Required
                      </span>
                    </div>
                  </div>
                </div>
              </button>

              <button
                onClick={() => handleProviderSelect("icloud")}
                className={`w-full p-4 rounded-lg border-2 ${
                  darkMode
                    ? "border-gray-700 hover:border-blue-500 bg-gray-750"
                    : "border-gray-200 hover:border-blue-500 bg-gray-50"
                } transition-colors text-left`}
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
                    <Mail className="w-6 h-6 text-gray-600 dark:text-gray-400" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold mb-1">
                      iCloud Mail
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Connect your iCloud Mail account with app-specific password
                    </p>
                    <div className="mt-2">
                      <span className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-400">
                        App-Specific Password Required
                      </span>
                    </div>
                  </div>
                </div>
              </button>

              <button
                onClick={() => handleProviderSelect("imap")}
                className={`w-full p-4 rounded-lg border-2 ${
                  darkMode
                    ? "border-gray-700 hover:border-blue-500 bg-gray-750"
                    : "border-gray-200 hover:border-blue-500 bg-gray-50"
                } transition-colors text-left`}
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0">
                    <Server className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold mb-1">
                      IMAP (Any Email Provider)
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Connect any email provider using IMAP (Yahoo, iCloud,
                      custom servers)
                    </p>
                    <div className="mt-2">
                      <span className="text-xs px-2 py-1 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400">
                        Universal Support
                      </span>
                    </div>
                  </div>
                </div>
              </button>

              <div
                className={`w-full p-4 rounded-lg border-2 ${
                  darkMode
                    ? "border-gray-700 bg-gray-750"
                    : "border-gray-200 bg-gray-50"
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
                    <Forward className="w-6 h-6 text-gray-600 dark:text-gray-400" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold mb-1">Email Forwarding</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                      Forward subscription emails to your unique address
                    </p>
                    <div className="bg-white dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
                      <code className="text-sm text-blue-600 dark:text-blue-400">
                        subscriptions+user123@subsync.ai
                      </code>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">
                      Set up a forwarding rule in your email client to
                      automatically send subscription emails to this address
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === "oauth" && (
            <div className="space-y-4">
              <div className="text-center py-8">
                <div className="w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mx-auto mb-4">
                  {provider === "gmail" ? (
                    <Mail className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                  ) : (
                    <Building2 className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                  )}
                </div>
                <h3 className="text-lg font-semibold mb-2">
                  Connect {provider === "gmail" ? "Gmail" : "Microsoft 365"}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                  You'll be redirected to{" "}
                  {provider === "gmail" ? "Google" : "Microsoft"} to authorize
                  access to your email
                </p>
                <Button
                  onClick={handleOAuthConnect}
                  disabled={loading}
                  className="min-w-[200px]"
                >
                  {loading ? "Connecting..." : "Continue with OAuth"}
                </Button>
              </div>
            </div>
          )}

          {step === "imap" && (
            <div className="space-y-4">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={imapConfig.email}
                    onChange={(e) => {
                      setImapConfig({ ...imapConfig, email: e.target.value });
                      detectImapSettings(e.target.value);
                    }}
                    placeholder="you@company.com"
                    className={`w-full px-4 py-2 rounded-lg border ${
                      darkMode
                        ? "bg-gray-750 border-gray-700 text-white"
                        : "bg-white border-gray-300 text-gray-900"
                    }`}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">
                    {provider === "yahoo" ? "App Password" : provider === "icloud" ? "App-Specific Password" : "Password"}
                  </label>
                  <input
                    type="password"
                    value={imapConfig.password}
                    onChange={(e) =>
                      setImapConfig({ ...imapConfig, password: e.target.value })
                    }
                    placeholder={provider === "yahoo" ? "Your Yahoo app password" : provider === "icloud" ? "Your iCloud app-specific password" : "Your email password"}
                    className={`w-full px-4 py-2 rounded-lg border ${
                      darkMode
                        ? "bg-gray-750 border-gray-700 text-white"
                        : "bg-white border-gray-300 text-gray-900"
                    }`}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {provider === "yahoo" 
                      ? "Create an app password in Yahoo Account Settings > Account Security" 
                      : provider === "icloud" 
                      ? "Create an app-specific password in Apple ID > Sign-In and Security"
                      : "Your password is encrypted and stored securely"}
                  </p>
                </div>

                {provider === "imap" && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        IMAP Host
                      </label>
                      <input
                        type="text"
                        value={imapConfig.host}
                        onChange={(e) =>
                          setImapConfig({ ...imapConfig, host: e.target.value })
                        }
                        placeholder="imap.example.com"
                        className={`w-full px-4 py-2 rounded-lg border ${
                          darkMode
                            ? "bg-gray-750 border-gray-700 text-white"
                            : "bg-white border-gray-300 text-gray-900"
                        }`}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-2">
                        Port
                      </label>
                      <input
                        type="text"
                        value={imapConfig.port}
                        onChange={(e) =>
                          setImapConfig({ ...imapConfig, port: e.target.value })
                        }
                        placeholder="993"
                        className={`w-full px-4 py-2 rounded-lg border ${
                          darkMode
                            ? "bg-gray-750 border-gray-700 text-white"
                            : "bg-white border-gray-300 text-gray-900"
                        }`}
                      />
                    </div>
                  </div>
                )}

                {error && (
                  <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
                    {error}
                  </div>
                )}

                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    onClick={() => setStep("provider")}
                    className="flex-1"
                    disabled={loading}
                  >
                    Back
                  </Button>
                  <Button
                    onClick={handleImapConnect}
                    className="flex-1"
                    disabled={loading}
                  >
                    {loading ? "Connecting..." : "Connect"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
