import { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createCspPolicy } from '../utils/csp';

// Security middleware configuration for the v3 gateway
// Derived from actual asset and connection needs of the new console

export const securityMiddleware = (app: any) => {
  // 1. Helmet: Set security headers
  // We use a custom CSP policy derived from the new console's needs
  const cspPolicy = createCspPolicy();

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: cspPolicy,
      },
      crossOriginEmbedderPolicy: false, // Often needed for mixed content in dashboards
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      dnsPrefetchControl: { allow: false },
      frameguard: { action: 'deny' },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
      ieNoOpen: true,
      noSniff: true,
      permittedCrossDomainPolicies: { permittedPolicies: 'none' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      xssFilter: true,
    })
  );

  // 2. Rate Limiting: Protect against abuse
  // Gateway-specific limits, distinct from dashboard rate limits
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  });

  app.use('/api/', limiter);

  // 3. Body Limiting: Prevent large payload attacks
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // 4. CORS: Configure for the new console's domain
  // Note: In a real app, this should be configurable via environment variables
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
  
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // 5. CSP Violation Reporting Endpoint
  // Repointed to the new policy and includes false-positive blocklist
  app.post('/api/csp-violations', (req: Request, res: Response) => {
    const violation = req.body;
    
    // Basic validation
    if (!violation || !violation['csp-report']) {
      return res.status(400).json({ error: 'Invalid CSP violation report' });
    }

    const report = violation['csp-report'];
    const blockedUri = report['blocked-uri'];
    const violatedDirective = report['violated-directive'];

    // False-positive blocklist
    // Add known safe sources that might trigger false positives
    const falsePositiveBlocklist = [
      'data:', // Often safe for inline scripts/styles
      'self', // Self-references are usually safe
    ];

    if (falsePositiveBlocklist.some(fp => blockedUri?.includes(fp) || violatedDirective?.includes(fp))) {
      // Silently ignore known false positives
      return res.status(204).send();
    }

    // Log the violation for monitoring
    console.error('CSP Violation:', {
      timestamp: new Date().toISOString(),
      blockedUri,
      violatedDirective,
      originalUri: report['original-uri'],
      sourceFile: report['source-file'],
      lineNumber: report['line-number'],
      columnNumber: report['column-number'],
      userAgent: req.headers['user-agent'],
    });

    // Acknowledge receipt
    res.status(200).json({ status: 'received' });
  });
};