
const crypto = require('crypto');

function generateCSP(nonce, reportOnly = false) {
  const cspHeader = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'nonce-${nonce}'`,
    `img-src 'self' blob: data: https://res.cloudinary.com https://*.supabase.co https://ui-avatars.com`,
    `font-src 'self'`,
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://*.stellar.org`,
    `frame-src 'self' https://js.stripe.com`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `upgrade-insecure-requests`,
  ].join("; ");

  const headerName = reportOnly
    ? "Content-Security-Policy-Report-Only"
    : "Content-Security-Policy";

  const policy = reportOnly
    ? `${cspHeader}; report-uri /api/csp-report`
    : cspHeader;

  return { headerName, policy };
}

const nonce = crypto.randomUUID();
const result = generateCSP(nonce, false);
console.log('Header Name:', result.headerName);
console.log('Policy:', result.policy);

if (result.headerName === 'Content-Security-Policy' && 
    result.policy.includes('https://res.cloudinary.com') &&
    result.policy.includes('https://*.stellar.org') &&
    result.policy.includes('nonce-' + nonce)) {
  console.log('✅ CSP Logic Verified');
} else {
  console.log('❌ CSP Logic Verification Failed');
  process.exit(1);
}
