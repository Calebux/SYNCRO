import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';

const CSRF_HEADER = 'x-csrf-token';
const CSRF_COOKIE = 'csrf-token';
const MUTATING_METHODS = new Set(['PATCH', 'DELETE', 'POST', 'PUT']);

/**
 * Double-submit cookie CSRF protection.
 *
 * On every request the middleware ensures a csrf-token cookie is set.
 * For mutating methods (PATCH / DELETE / POST / PUT) it additionally
 * validates that the `x-csrf-token` request header matches the cookie value.
 *
 * Acceptance criteria: API rejects requests missing the custom header.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  // Ensure the cookie is always present so clients can read it
  if (!req.cookies?.[CSRF_COOKIE]) {
    const token = generateToken();
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false, // must be readable by JS so the client can copy it into the header
      sameSite: 'strict',
      secure: env.NODE_ENV === 'production',
    });
    // Attach to req.cookies so the validation below works in the same request
    if (!req.cookies) (req as any).cookies = {};
    req.cookies[CSRF_COOKIE] = token;
  }

  if (MUTATING_METHODS.has(req.method)) {
    const cookieToken = req.cookies[CSRF_COOKIE];
    const headerToken = req.headers[CSRF_HEADER] as string | undefined;

    if (!headerToken || headerToken !== cookieToken) {
      res.status(403).json({
        error: 'Forbidden',
        message: `Missing or invalid ${CSRF_HEADER} header`,
      });
      return;
    }
  }

  next();
}

function generateToken(): string {
  const array = new Uint8Array(32);
  // Use Node's crypto when available (avoids importing crypto at module level)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('crypto').randomFillSync(array);
  return Buffer.from(array).toString('hex');
}
