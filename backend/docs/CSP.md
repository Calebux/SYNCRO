# Content Security Policy (CSP)

## Overview

This document defines the Content Security Policy (CSP) for the v3 console and gateway. The policy is derived from the actual asset and connection needs of the new console, rather than being ported from the previous subscription console.

## Policy Derivation

The CSP is generated dynamically based on the following sources:

1. **Static Assets**: All JavaScript, CSS, and image assets served from the `/static` directory.
2. **External CDNs**: Trusted CDNs for fonts, analytics, and third-party widgets.
3. **Inline Scripts/Styles**: Minimal inline content required for initial page load.
4. **API Endpoints**: Connections to internal and external API services.
5. **WebSocket Connections**: Real-time updates via WebSocket.

## Directives

### default-src
- `'self'`: Allow loading resources from the same origin.

### script-src
- `'self'`: Allow scripts from the same origin.
- `'unsafe-inline'`: Required for inline scripts (minimize if possible).
- `'unsafe-eval'`: Required for certain libraries (minimize if possible).
- `https://cdn.example.com`: Trusted CDN for external scripts.

### style-src
- `'self'`: Allow styles from the same origin.
- `'unsafe-inline'`: Required for inline styles (minimize if possible).
- `https://fonts.googleapis.com`: Trusted CDN for fonts.

### img-src
- `'self'`: Allow images from the same origin.
- `data:`: Allow inline images (e.g., base64 encoded).
- `https://images.example.com`: Trusted CDN for images.

### font-src
- `'self'`: Allow fonts from the same origin.
- `https://fonts.gstatic.com`: Trusted CDN for fonts.

### connect-src
- `'self'`: Allow connections to the same origin.
- `https://api.example.com`: Trusted API endpoint.
- `wss://ws.example.com`: Trusted WebSocket endpoint.

### media-src
- `'self'`: Allow media from the same origin.

### object-src
- `'none'`: Disallow plugins.

### frame-src
- `'none'`: Disallow framing.

### child-src
- `'none'`: Disallow child frames.

### worker-src
- `'self'`: Allow web workers from the same origin.

### base-uri
- `'self'`: Restrict base URIs to the same origin.

### form-action
- `'self'`: Restrict form submissions to the same origin.

## Violation Reporting

CSP violations are reported to the `/api/csp-violations` endpoint. The reporting endpoint includes a false-positive blocklist to ignore known safe sources that might trigger false positives.

### False-Positive Blocklist

The following sources are considered safe and will be ignored:

- `data:`: Inline data URIs.
- `self`: Self-references.

## Maintenance

- Review and update the CSP policy whenever new assets or external services are added.
- Monitor CSP violation reports to identify potential issues or attacks.
- Minimize the use of `'unsafe-inline'` and `'unsafe-eval'` to improve security.

## References

- [MDN CSP Documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [Google CSP Evaluator](https://csp-evaluator.withgoogle.com/)