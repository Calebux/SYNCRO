# SYNCRO Tor Browser Compatibility Guide

## Overview

This document outlines SYNCRO's compatibility with Tor Browser and provides guidance for users accessing the dashboard through Tor.

**Status**: ✅ Core dashboard functionality is compatible with Tor Browser

## What is Tor Browser?

Tor Browser is a privacy-focused web browser based on Mozilla Firefox that:
- Routes all traffic through the Tor network for anonymity
- Disables certain Web APIs to prevent fingerprinting
- Uses HTTP for `.onion` addresses (privacy-preserving alternative to HTTPS)
- Resets browser state on each session for privacy

**Learn more**: https://www.torproject.org/download/

## Compatibility Status

### ✅ Fully Compatible Features

- **Dashboard UI & Navigation**: All pages render correctly
- **User Authentication**: Signup, login, and session management work as expected
- **Storage**: localStorage and sessionStorage function normally
- **API Communication**: Fetch API and standard HTTP requests work
- **Subscription Management**: Adding subscriptions, viewing history all work
- **Reminder Notifications**: Email/SMS reminders deliver correctly
- **Payment Processing**: Stripe integration works (with considerations below)
- **CSP Headers**: Content Security Policy is configured to support Tor Browser

### ⚠️ Known Limitations

#### 1. **Freighter Wallet Extension (NOT COMPATIBLE)**

**Issue**: The Freighter Stellar wallet browser extension does not work in Tor Browser.

**Reason**: Tor Browser has strict extension policies for security and privacy. Most wallet extensions are not compatible.

**Workaround**:
- Use SYNCRO without Freighter-based wallet verification
- Alternative: Access dashboard from a regular Chrome/Firefox browser for wallet-dependent features
- Contact support if you need assistance with alternative payment methods

**Status in UI**: The app will display a warning when accessing wallet verification features in Tor Browser.

#### 2. **WebGL & Graphics APIs**

**Issue**: WebGL is disabled in Tor Browser to prevent fingerprinting.

**Impact**: Minimal - SYNCRO uses WebGL only for optional visualizations, not core functionality.

**Workaround**: All dashboard features work without WebGL.

#### 3. **Geolocation API**

**Issue**: Geolocation is intentionally disabled in Tor Browser.

**Impact**: Minimal - SYNCRO does not use geolocation for core features.

**Note**: Your location is already protected by Tor routing, so geolocation is unnecessary.

### ✅ Security Headers

SYNCRO's Content Security Policy (CSP) has been updated to support Tor Browser:

```
- Removed: upgrade-insecure-requests
  (Reason: .onion addresses use http:// by design, not https://)
  
- Added support for: localhost connections
  (Reason: Tor local services may use non-HTTPS addresses)
  
- Maintained: strict policy for external resources
  (Reason: External APIs still use HTTPS for security)
```

## How to Access SYNCRO via Tor

### Method 1: Regular Tor Browser (Recommended)

1. Download Tor Browser from https://www.torproject.org/download/
2. Open Tor Browser
3. Navigate to the SYNCRO dashboard URL
4. Create account or login
5. Use normally - all features except Freighter wallet work

### Method 2: Tor Network with Regular Browser

If running a self-hosted SYNCRO instance:

1. Set up a `.onion` hidden service (Tor onion mirror)
2. Access via `https://your-service.onion` from Tor Browser
3. Or access from any browser via Tor proxy (http://127.0.0.1:9050)

**Setup instructions** (if self-hosting):
- See `docs/TOR_ONION_SETUP.md` for Tor hidden service configuration
- Enable `ENABLE_ONION_SERVICE=true` in environment variables
- Restart SYNCRO to generate `.onion` address

## Testing Checklist for Tor Browser

The following flow has been verified to work in Tor Browser:

- [x] Access dashboard homepage
- [x] User signup/registration
- [x] Email verification
- [x] Login with email + password
- [x] Two-factor authentication (TOTP/Recovery codes)
- [x] Add subscription via payment method
- [x] View subscription details
- [x] Receive reminder notifications
- [x] Purchase gift card
- [x] View invoice history
- [x] Update account settings
- [x] View analytics (read-only)
- [x] Logout and login again

❌ **Not tested/Not working**:
- Freighter wallet verification (limitation documented)
- WebGL-based visualizations (not critical)

## Security Considerations

### Privacy with Tor Browser

When accessing SYNCRO via Tor Browser:

1. **Your IP is hidden**: All traffic routed through Tor network
2. **Your location is masked**: Tor exit nodes may appear from different countries
3. **Your usage is more private**: ISPs cannot see which sites you visit
4. **SYNCRO cannot identify you by IP**: Session-based auth only

### Tor Browser's Built-in Protections

SYNCRO respects Tor Browser's security features:

- **No fingerprinting detection**: We don't attempt to fingerprint users
- **No canvas probing**: We don't use canvas APIs to detect Tor
- **No WebGL warnings**: We handle WebGL gracefully when disabled
- **No unnecessary plug-ins**: SYNCRO doesn't require Flash, Java, etc.

### Recommended Practices

When using SYNCRO via Tor:

1. ✅ Use a strong, unique password
2. ✅ Enable two-factor authentication (TOTP)
3. ✅ Keep Tor Browser updated
4. ✅ Don't maximize your browser window (reduces fingerprinting)
5. ✅ Don't download files unless necessary (can expose your IP)
6. ❌ Don't disable Tor security settings for "better performance"
7. ❌ Don't combine Tor access with non-Tor activities in the same browser session

## Support & Troubleshooting

### Common Issues

**Q: "Freighter wallet extension is not installed"**
- **A**: This is expected in Tor Browser. Freighter doesn't work with Tor. Use payment methods without wallet verification.

**Q: Page loads slowly**
- **A**: Tor routing adds latency. This is normal. Content should load within 5-10 seconds.

**Q: Some images don't load**
- **A**: Check CSP warnings in browser console. Ensure image domains are whitelisted in CSP policy.

**Q: Getting logged out frequently**
- **A**: Tor Browser clears cookies on exit. Enable "Remember me" or use session persistence settings.

### Reporting Issues

If you encounter Tor-specific issues:

1. Note the exact error message
2. Check browser console (F12 → Console tab)
3. Take a screenshot if relevant
4. Report to: support@syncro.app with subject: "[Tor Browser]"

Include:
- Tor Browser version
- SYNCRO app version
- Step-by-step reproduction
- Error message/logs

## Future Enhancements

Planned improvements for Tor support:

- [ ] Tor-specific .onion mirror (if self-hosted)
- [ ] Built-in Tor routing mode (no external Tor needed)
- [ ] Tor-compatible wallet alternatives
- [ ] Tor-specific onboarding experience
- [ ] Load balancing across Tor exit nodes

## Additional Resources

- **Tor Project**: https://www.torproject.org/
- **Tor Browser Manual**: https://tb-manual.torproject.org/
- **Browser Security**: https://www.eff.org/deeplinks/2015/04/browser-security
- **Freighter Wallet**: https://www.freighter.app/ (not Tor-compatible)
- **SYNCRO Security**: See `docs/SECURITY_AUDIT_MATRIX.md`

## Questions?

For support related to Tor Browser or privacy features:
- Email: support@syncro.app
- Documentation: https://docs.syncro.app/privacy
- GitHub Issues: https://github.com/Calebux/SYNCRO/issues

---

**Last Updated**: 2024-12-25
**Documentation Version**: 1.0
**Tor Browser Tested On**: v14.0+
