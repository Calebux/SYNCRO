import axios from "axios";
import { v4 as uuidv4 } from "uuid";

const STAGING_API  = "https://backend-staging.onrender.com";
const PROD_API     = "https://backend-ai-sub.onrender.com";

const API_BASE =
  // Canonical name; NEXT_PUBLIC_API_BASE kept as a deprecated fallback so
  // already-deployed environments keep working (see docs/ENVIRONMENT.md).
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_API_BASE ||
  (process.env.NEXT_PUBLIC_APP_ENV === "staging" ? STAGING_API : PROD_API);

const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true, // This ensures cookies are sent with requests
  headers: {
    "Content-Type": "application/json",
  },
});

/** Read the csrf-token cookie set by the backend and attach it as a header. */
function getCsrfToken(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(/(?:^|;\s*)csrf-token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

/**
 * Generate a correlation ID for client requests.
 * Uses a simple UUID v4 on the client side.
 * The backend will use this ID or generate its own UUID v7 if not provided.
 */
function generateCorrelationId(): string {
  return `client:${uuidv4()}`;
}

/**
 * Store the last correlation ID received from the server.
 * This allows us to track the correlation ID across related requests.
 */
let lastServerCorrelationId: string | undefined;

/**
 * Get the last correlation ID received from the server.
 * Useful for logging and debugging on the client side.
 */
export function getLastCorrelationId(): string | undefined {
  return lastServerCorrelationId;
}

const MUTATING_METHODS = new Set(["post", "put", "patch", "delete"]);

// Attach x-csrf-token and X-Correlation-ID headers on all requests
api.interceptors.request.use((config) => {
  config.headers = config.headers ?? {};
  
  // Attach CSRF token for mutating requests
  if (config.method && MUTATING_METHODS.has(config.method.toLowerCase())) {
    const token = getCsrfToken();
    if (token) {
      config.headers["x-csrf-token"] = token;
    }
  }
  
  // Attach correlation ID for all requests (for end-to-end tracing)
  // If the caller provides a correlation ID, use it; otherwise generate a new one
  if (!config.headers["X-Correlation-ID"]) {
    config.headers["X-Correlation-ID"] = generateCorrelationId();
  }
  
  return config;
});

// Add response interceptor to capture correlation ID and log auth errors
api.interceptors.response.use(
  (response) => {
    // Extract and store correlation ID from response headers
    const correlationId = response.headers?.["x-correlation-id"] || response.headers?.["X-Correlation-ID"];
    if (correlationId) {
      lastServerCorrelationId = correlationId;
    }
    return response;
  },
  (error) => {
    // Extract correlation ID even from error responses for debugging
    if (error.response?.headers) {
      const correlationId = error.response.headers["x-correlation-id"] || error.response.headers["X-Correlation-ID"];
      if (correlationId) {
        lastServerCorrelationId = correlationId;
      }
    }
    
    if (error.response?.status === 401) {
      console.debug("401 Unauthorized - user not authenticated", {
        correlationId: lastServerCorrelationId,
      });
    } else if (error.response?.status >= 500) {
      console.error("Server error", {
        status: error.response.status,
        correlationId: lastServerCorrelationId,
        message: error.message,
      });
    }
    return Promise.reject(error);
  }
);

// Simple wrappers to normalize responses and errors
export async function apiGet(path: string, config = {}) {
  const res = await api.get(path, config as any);
  return res.data;
}

export async function apiPost(path: string, data?: any, config = {}) {
  const res = await api.post(path, data, config as any);
  return res.data;
}

export async function apiPut(path: string, data?: any, config = {}) {
  const res = await api.put(path, data, config as any);
  return res.data;
}

export async function apiPatch(path: string, data?: any, config = {}) {
  const res = await api.patch(path, data, config as any);
  return res.data;
}

export async function apiDelete(path: string, config = {}) {
  const res = await api.delete(path, config as any);
  return res.data;
}

export default api;
