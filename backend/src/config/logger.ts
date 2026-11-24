import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { requestContextStorage } from '../middleware/requestContext';

/**
 * Configuration for sensitive field redaction
 */
const SENSITIVE_FIELDS = {
  // Email patterns
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  // Token patterns (JWT, API keys, etc.)
  token: /\b[A-Za-z0-9_-]{20,}\b/g,
  // Authorization headers
  authorization: /Bearer\s+[A-Za-z0-9_-]+/gi,
  // API key headers
  apiKey: /[A-Za-z0-9_-]{32,}/g,
  // Password fields
  password: /"password"\s*:\s*"[^"]*"/gi,
  // Credit card numbers (basic pattern)
  creditCard: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
};

/**
 * Recursively redact sensitive data from objects
 */
function redactSensitiveData(obj: any, depth = 0, seen = new WeakSet()): any {
  // Prevent infinite recursion
  if (depth > 10) return '[MAX_DEPTH_REACHED]';
  
  if (obj === null || obj === undefined) return obj;
  
  // Handle circular references
  if (typeof obj === 'object' && seen.has(obj)) {
    return '[CIRCULAR_REFERENCE]';
  }
  
  // Handle strings - apply regex patterns
  if (typeof obj === 'string') {
    let redacted = obj;
    
    // Apply email redaction
    redacted = redacted.replace(SENSITIVE_FIELDS.email, '[REDACTED]');
    
    // Apply token redaction (but be more careful with JWT tokens)
    redacted = redacted.replace(SENSITIVE_FIELDS.token, '[REDACTED]');
    
    // Apply authorization header redaction
    redacted = redacted.replace(SENSITIVE_FIELDS.authorization, 'Bearer [REDACTED]');
    
    // Apply API key redaction
    redacted = redacted.replace(SENSITIVE_FIELDS.apiKey, '[REDACTED]');
    
    // Apply password field redaction
    redacted = redacted.replace(SENSITIVE_FIELDS.password, '"password":"[REDACTED]"');
    
    // Apply credit card redaction
    redacted = redacted.replace(SENSITIVE_FIELDS.creditCard, '[REDACTED]');
    
    return redacted;
  }
  
  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => redactSensitiveData(item, depth + 1, seen));
  }
  
  // Handle objects
  if (typeof obj === 'object') {
    // Add to seen set to prevent circular references
    seen.add(obj);
    
    const redacted: any = {};
    
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      
      // Check for sensitive field names (exact matches first, then partial)
      if (lowerKey === 'email' || lowerKey.includes('email')) {
        redacted[key] = '[REDACTED]';
      } else if (lowerKey === 'password' || lowerKey.includes('password')) {
        redacted[key] = '[REDACTED]';
      } else if (lowerKey === 'token' || lowerKey === 'accesstoken' || lowerKey === 'refreshtoken' || lowerKey === 'authtoken') {
        redacted[key] = '[REDACTED]';
      } else if (lowerKey === 'authorization' || lowerKey.includes('authorization')) {
        redacted[key] = '[REDACTED]';
      } else if (lowerKey === 'apikey' || (lowerKey.includes('key') && lowerKey.includes('api'))) {
        redacted[key] = '[REDACTED]';
      } else if (lowerKey === 'secret' || lowerKey === 'clientsecret' || lowerKey === 'apisecret') {
        redacted[key] = '[REDACTED]';
      } else if (lowerKey.includes('credit') || (lowerKey.includes('card') && lowerKey.includes('number'))) {
        redacted[key] = '[REDACTED]';
      } else {
        // Recursively process the value
        redacted[key] = redactSensitiveData(value, depth + 1, seen);
      }
    }
    
    // Remove from seen set after processing
    seen.delete(obj);
    return redacted;
  }
  
  // Return primitive values as-is
  return obj;
}

/**
 * Custom Winston format for PII redaction
 * Masks sensitive data like emails, tokens, and other PII from log entries
 */
const piiRedactionFormat = winston.format((info: winston.Logform.TransformableInfo) => {
  try {
    const ctx = requestContextStorage.getStore();
    const isPrivacyMode = ctx?.isPrivacyModeEnabled;

    // Create a shallow copy first
    const redactedInfo = { ...info };
    
    // If privacy mode is enabled, heavily redact the message and metadata
    if (isPrivacyMode) {
      if (typeof redactedInfo.message === 'string') {
        redactedInfo.message = redactSensitiveData(redactedInfo.message);
      }
      
      for (const [key, value] of Object.entries(redactedInfo)) {
        if (
          key !== 'level' &&
          key !== 'timestamp' &&
          key !== 'requestId' &&
          key !== 'userId' &&
          key !== 'service'
        ) {
          redactedInfo[key] = '[REDACTED_PRIVACY_MODE]';
        }
      }
      return redactedInfo;
    }

    // Redact the message
    if (typeof redactedInfo.message === 'string') {
      redactedInfo.message = redactSensitiveData(redactedInfo.message);
    }
    
    // Redact all other properties - check each key individually for sensitive field names
    for (const [key, value] of Object.entries(redactedInfo)) {
      if (key !== 'level' && key !== 'timestamp') {
        const lowerKey = key.toLowerCase();
        
        // Check if this is a sensitive field name at the top level
        if (lowerKey === 'email' || lowerKey.includes('email')) {
          redactedInfo[key] = '[REDACTED]';
        } else if (lowerKey === 'password' || lowerKey.includes('password')) {
          redactedInfo[key] = '[REDACTED]';
        } else if (lowerKey === 'token' || lowerKey === 'accesstoken' || lowerKey === 'refreshtoken' || lowerKey === 'authtoken') {
          redactedInfo[key] = '[REDACTED]';
        } else if (lowerKey === 'authorization' || lowerKey.includes('authorization')) {
          redactedInfo[key] = '[REDACTED]';
        } else if (lowerKey === 'apikey' || (lowerKey.includes('key') && lowerKey.includes('api'))) {
          redactedInfo[key] = '[REDACTED]';
        } else if (lowerKey === 'secret' || lowerKey === 'clientsecret' || lowerKey === 'apisecret') {
          redactedInfo[key] = '[REDACTED]';
        } else if (lowerKey.includes('credit') || (lowerKey.includes('card') && lowerKey.includes('number'))) {
          redactedInfo[key] = '[REDACTED]';
        } else {
          // For non-sensitive field names, recursively process the value
          redactedInfo[key] = redactSensitiveData(value);
        }
      }
    }
    
    return redactedInfo;
  } catch (error) {
    // If redaction fails, return original info with error message
    return {
      ...info,
      redactionError: 'Failed to redact sensitive data'
    };
  }
});

/**
 * Custom Winston format that automatically injects `requestId` and `userId`
 * from the current AsyncLocalStorage context into every log entry.
 * No manual propagation is required in service or route code.
 */
const requestContextFormat = winston.format((info: winston.Logform.TransformableInfo) => {
  const ctx = requestContextStorage.getStore();
  if (ctx) {
    info['requestId'] = ctx.requestId;
    if (ctx.userId) {
      if (ctx.isPrivacyModeEnabled) {
        info['userId'] = '[REDACTED_PRIVACY]';
      } else {
        info['userId'] = ctx.userId;
      }
    }
  }
  return info;
});

/**
 * Keys to be masked in logs.
 */
const SENSITIVE_KEYS = [
  'password',
  'secret',
  'key',
  'token',
  'auth',
  'pass',
  'stellar_secret_key',
  'soroban_secret',
  'jwt_secret',
  'stripe_secret_key',
  'google_client_secret',
  'microsoft_client_secret',
];

/**
 * Custom Winston format to mask sensitive information.
 */
const maskFormat = winston.format((info) => {
  const mask = (obj: any): any => {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(mask);
    }

    const maskedObj: any = {};
    for (const key in obj) {
      const val = obj[key];
      if (SENSITIVE_KEYS.some((sk) => key.toLowerCase().includes(sk))) {
        maskedObj[key] = '***MASKED***';
      } else if (typeof val === 'object' && val !== null) {
        maskedObj[key] = mask(val);
      } else {
        maskedObj[key] = val;
      }
    }
    return maskedObj;
  };

  const maskedInfo = mask(info);
  
  // Restore internal Winston properties that might have been lost or transformed
  // (Winston uses symbols and some specific properties)
  return { ...info, ...maskedInfo };
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    requestContextFormat(),          // inject requestId / userId first
    maskFormat(),                    // mask secrets
    piiRedactionFormat(),            // redact sensitive data
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'synchro-backend' },
  transports: [
    new DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '10m',
      maxFiles: '30d',
      level: 'error',
    }),
    new DailyRotateFile({
      filename: 'logs/combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
    }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        requestContextFormat(),
        piiRedactionFormat(),        // also redact in console output
        winston.format.colorize(),
        winston.format.printf((info: winston.Logform.TransformableInfo) => {
          const { level, message, timestamp, requestId, userId, ...meta } = info as {
            level: string;
            message: string;
            timestamp: string;
            requestId?: string;
            userId?: string;
            [key: string]: unknown;
          };
          const rid = requestId ? ` [${requestId}]` : '';
          const uid = userId ? ` [user:${userId}]` : '';
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          return `${timestamp} ${level}${rid}${uid}: ${message}${metaStr}`;
        })
      ),
    })
  );
}

export default logger;

// Export the PII redaction format for testing
export { piiRedactionFormat };
