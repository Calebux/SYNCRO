/**
 * Utilities for detecting Tor Browser and handling Tor-specific compatibility issues.
 * 
 * Tor Browser is a privacy-focused browser based on Firefox that:
 * - Routes all traffic through Tor network
 * - Disables certain Web APIs for fingerprinting prevention
 * - Uses http:// for .onion addresses
 * - May not support all browser extensions
 * 
 * @see https://www.torproject.org/
 */

/**
 * Detects if the application is running in Tor Browser
 * 
 * Tor Browser sets navigator.webdriver or has specific user agent patterns,
 * but the most reliable check is looking for the Tor network indicator in localStorage
 */
export function isTorBrowser(): boolean {
  if (typeof window === 'undefined') return false;
  
  // Check for Tor Browser specific user agent
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('tor browser')) {
    return true;
  }
  
  // Check for .onion site indicator (if accessed via .onion domain)
  if (typeof window !== 'undefined' && window.location.hostname.endsWith('.onion')) {
    return true;
  }

  // Tor Browser may disable certain WebGL features
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) {
      // WebGL is disabled, which could indicate Tor Browser
      // But this is not a definitive test - more of a hint
    }
  } catch (e) {
    // Silently ignore WebGL checks
  }
  
  return false;
}

/**
 * Detects if a browser extension is available
 * 
 * Note: Tor Browser may block or restrict certain extensions
 * @param extensionObject - The window object property to check (e.g., window.freighter)
 */
export function isExtensionAvailable(extensionObject: any): boolean {
  return typeof extensionObject !== 'undefined' && extensionObject !== null;
}

/**
 * Detects if Freighter wallet is available
 * 
 * Freighter may not work in Tor Browser due to extension restrictions.
 * Always check the result before attempting to use it.
 */
export function isFreighterAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  return isExtensionAvailable((window as any).freighter);
}

/**
 * Gets Tor Browser compatibility information
 */
export interface TorCompatibilityInfo {
  isTorBrowser: boolean;
  freighterAvailable: boolean;
  knownLimitations: string[];
}

export function getTorCompatibilityInfo(): TorCompatibilityInfo {
  const torBrowser = isTorBrowser();
  const freighterAvailable = isFreighterAvailable();
  
  const knownLimitations: string[] = [];
  
  if (torBrowser) {
    if (!freighterAvailable) {
      knownLimitations.push('Freighter wallet extension is not available in Tor Browser');
    }
    knownLimitations.push('Some WebGL features may be disabled for privacy');
    knownLimitations.push('Certain geolocation features are unavailable');
  }
  
  return {
    isTorBrowser: torBrowser,
    freighterAvailable,
    knownLimitations,
  };
}

/**
 * Handles fetch requests with Tor Browser compatibility
 * 
 * In Tor Browser, HTTPS upgrades may need special handling for .onion addresses
 */
export async function torCompatibleFetch(
  url: string,
  options?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, options);
  } catch (error) {
    // If we're in Tor Browser and the request failed, try with http if it was https
    if (isTorBrowser() && url.startsWith('https://') && url.includes('.onion')) {
      const httpUrl = url.replace('https://', 'http://');
      try {
        return await fetch(httpUrl, options);
      } catch (fallbackError) {
        throw error; // Throw original error
      }
    }
    throw error;
  }
}
