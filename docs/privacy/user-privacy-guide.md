# SYNCRO Privacy Guide — Maximize Your Payment Privacy

Welcome! This guide explains how to use SYNCRO's privacy features to keep your subscription payments and identity completely private. Even if you're not technical, these tools are designed to be straightforward.

---

## Quick Start: Privacy Checklist

- [ ] **Use stealth addresses** for receiving payments
- [ ] **Enable encrypted metadata** so the server can't see what you're subscribing to
- [ ] **Add timing jitter** to reminders to avoid predictable patterns
- [ ] **Buy gift cards through Tor or VPN** to avoid linking your identity
- [ ] **Use payment channels** for recurring payments (keeps most data off-chain)
- [ ] **Disable browser tracking** in your privacy settings
- [ ] **Maintain separate wallets** for different subscriptions

---

## 1. Stealth Addresses: Hide Your Wallet Identity

### What They Do

A stealth address is a one-time, unique payment address created just for you. Every payment you receive goes to a completely different address — so no one can link payments together or connect them to your wallet.

**In plain English**: Instead of reusing the same wallet address (which reveals all your transactions), you get a fresh address each time. It's like having a unique mailbox for each payment.

### How It Works (Simple Version)

```
1. You share a special code (your "stealth meta-address") with people who pay you
2. When they send money, they generate a unique address using your code
3. The payment arrives at that unique address
4. You can see ALL payments (even though they landed on different addresses)
5. Nobody else can link the payments together
```

### How to Use Stealth Addresses in SYNCRO

1. Go to **Settings → Privacy → Stealth Addresses**
2. Generate your stealth meta-address
3. Share the generated code with anyone who needs to send you payment
4. All payments appear in your SYNCRO dashboard, but remain unlinkable on-chain

### Why This Matters for Subscription Privacy

- **Hides subscription amounts**: Each payment goes to a different address
- **Prevents correlation**: Observers can't group payments by wallet
- **Survives blockchain analysis**: Even sophisticated chain analysis can't link your payments
- **Future-proof**: Works indefinitely; old payments stay private

### Best Practice

Enable stealth addresses **before** receiving any payments. Once you have a stealth meta-address, use it consistently for all SYNCRO-related payments.

---

## 2. Encrypted Metadata: Hide What You're Paying For

### What It Does

Your subscription details (Netflix, Spotify, etc.) are encrypted with a key only you have. The SYNCRO server sees only encrypted gibberish—not your actual subscriptions.

**Example**:
- Without encryption: `{"name": "Netflix", "price": "15.99", "provider": "netflix.com"}`
- With encryption: `7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d...` (meaningless without your key)

### How It Works

1. Your browser generates a random 256-bit encryption key
2. When you add a subscription, your browser encrypts it before sending to SYNCRO
3. SYNCRO stores only the encrypted version
4. When you load the dashboard, your browser decrypts subscriptions locally
5. The key never leaves your device

### Enabling Encrypted Metadata

1. Open SYNCRO and go to **Settings → Privacy → Metadata Encryption**
2. Click **Enable Encryption**
3. Your browser automatically generates and secures your key
4. All new subscriptions are encrypted automatically

### What's Protected?

- ✅ Subscription name (Netflix, Spotify, Hulu, etc.)
- ✅ Price and billing cycle
- ✅ Provider URL
- ✅ Custom notes or categories

### What's NOT Encrypted?

- Payment amounts (stored separately for billing verification)
- Timestamps (needed for reminders)
- Authentication credentials (SYNCRO never sees these)

### Important: Back Up Your Encryption Key

Your encryption key is stored securely in your browser. If you lose it:
- You won't be able to decrypt old subscriptions
- New subscriptions won't have your key

**How to back up**:
1. Go to **Settings → Privacy → Export Key**
2. Download your key to a secure location (encrypted USB, password manager, etc.)
3. Store it somewhere only you can access

---

## 3. Reminder Timing Jitter: Avoid Predictable Patterns

### What It Does

Instead of always sending reminders at the same time, SYNCRO randomizes the timing within a window. This prevents observers from noticing recurring patterns that might reveal your subscriptions.

**Example**:
- Without jitter: Netflix reminder on the 15th at 9:00 AM every month
- With jitter: Netflix reminder on the 13th-17th, anywhere from 7:00 AM - 11:00 AM

### Why This Matters

Blockchain analysis tools can spot regular, predictable transactions. By randomizing reminder timing, you avoid creating detectable patterns that could reveal:
- Which services you subscribe to
- How much you spend
- When you renew subscriptions

### How to Enable Jitter

1. Go to **Settings → Reminders → Privacy**
2. Enable **Timing Jitter**
3. Choose your jitter window (default: ±2 days, ±2 hours)

### Jitter Settings Explained

| Setting | Effect | Privacy |
|---------|--------|---------|
| **No Jitter** | Reminders always at same time | Easiest to track |
| **Day Jitter (±1 day)** | Reminder within 1-day window | Better |
| **Day + Hour Jitter (±2d, ±2h)** | Within 2 days and 2 hours | Recommended |
| **Max Jitter (±3d, ±4h)** | Within 3 days and 4 hours | Maximum privacy |

### Note

Reminders always arrive **before** renewal, so you have time to act. Jitter never delays a reminder past the renewal date.

---

## 4. Verify Encrypted On-Chain Data

### What It Does

SYNCRO stores subscription metadata on the blockchain in encrypted form. You can verify:
- That your data is encrypted (not readable by observers)
- That SYNCRO has the data you entered
- That nothing was tampered with

### How to Verify

1. Go to **Settings → Privacy → Stealth Payments**
2. Click **Verify Encrypted Data**
3. SYNCRO scans the blockchain for your encrypted records
4. You see a list of verified subscriptions with encryption confirmation

### What Verification Proves

- ✅ Data integrity: Your subscription details haven't been modified
- ✅ Encryption status: Data is genuinely encrypted (not plain text)
- ✅ Your ownership: Only your viewing key can decrypt the data
- ✅ Blockchain proof: Records permanently stored on Stellar

### What Verification Does NOT Prove

- ❌ Server data matches your expectations (you must verify locally)
- ❌ Data isn't stored elsewhere (it may be)
- ❌ All your data is encrypted (only data you've verified is confirmed)

### How Often Should You Verify?

- **First time**: After creating your stealth address
- **Regularly**: Once a month as part of privacy maintenance
- **After disputes**: If you suspect data tampering or unauthorized access

---

## 5. Payment Channels: Private Recurring Payments

### What They Do

Payment channels keep most of your subscription payments **off-chain** (private), with only two transactions visible on the blockchain:
1. Opening the channel (deposit)
2. Closing the channel (settlement)

All the renewals in between? Completely hidden.

### How It Works

```
1. You create a payment channel with SYNCRO
   └─ Deposit funds (visible on-chain)
   
2. For each subscription renewal:
   └─ You and SYNCRO exchange signed messages (OFF-CHAIN)
   └─ No transaction on blockchain
   
3. When ready, close the channel
   └─ Final settlement transaction (visible on-chain)
   
Result: Only 2 blockchain transactions instead of 50+ renewals
```

### Example

**Without Payment Channels** (all visible):
```
Jan 1: Netflix payment → $15 (transaction 1)
Feb 1: Netflix payment → $15 (transaction 2)
Mar 1: Netflix payment → $15 (transaction 3)
...and so on (50+ transactions per year)
```

**With Payment Channels** (mostly hidden):
```
Jan 1: Open channel, deposit $250 (transaction 1 - visible)
Jan 1 - Dec 31: Netflix renewals × 12 (transactions 2-13 - OFF-CHAIN, private)
Dec 31: Close channel, settle funds (transaction 2 - visible)
```

### Privacy Benefit

Even though observers know you're using SYNCRO, they can't see:
- Individual subscription amounts
- Renewal dates
- Which services you're subscribed to
- How many times you renewed

### How to Use Payment Channels

1. Go to **Settings → Payment Channels**
2. Click **Create Channel**
3. Choose subscriptions to fund (or deposit general amount)
4. Sign transaction to open channel
5. Renewals now happen privately off-chain
6. Close channel anytime to settle with SYNCRO

### When to Use Payment Channels

- ✅ Multiple subscriptions (saves on-chain fees)
- ✅ Monthly or weekly renewals (keeps activity private)
- ✅ Long-term subscriptions (you'll renew many times)

---

## 6. Browser Privacy Settings: Disable Tracking

Your browser is your first line of defense. Follow these steps to block fingerprinting and tracking:

### 6.1 Disable WebRTC Leaks (Critical)

WebRTC can expose your real IP address even when using a VPN. Disable it:

**Chrome/Brave**:
1. Type `chrome://flags/#enable-webrtc-hide-local-ips` in address bar
2. Set to **Disabled**
3. Restart browser

**Firefox**:
1. Type `about:config` in address bar
2. Search for `media.peerconnection`
3. Set these to `false`:
   - `media.peerconnection.enabled`
   - `media.peerconnection.ice.tcp`
   - `media.peerconnection.ice.ipv6_disabled` (set to `true`)
4. Save

**Safari**:
1. Preferences → Privacy
2. Uncheck **Allow privacy-preserving ad measurement**

### 6.2 Use Private Browsing Mode

Enable private/incognito mode when accessing SYNCRO:

**Chrome/Brave/Edge**: `Ctrl+Shift+N` (Windows) / `Cmd+Shift+N` (Mac)
**Firefox**: `Ctrl+Shift+P` (Windows) / `Cmd+Shift+P` (Mac)
**Safari**: `Cmd+Shift+N`

**Benefits**:
- Browser history not saved
- Cookies deleted on close
- Tracking prevention active
- No fingerprinting data retained

### 6.3 Configure DNS-over-HTTPS (DoH)

Prevent your ISP from seeing which websites you visit:

**Chrome**:
1. Settings → Privacy and security → Security
2. Enable **"Use secure DNS"**
3. Select **"Custom" and use:**
   - `https://1.1.1.1/dns-query` (Cloudflare)
   - `https://dns.quad9.net/dns-query` (Quad9)
   - `https://dns.nextdns.io` (NextDNS)

**Firefox**:
1. Preferences → Privacy & Security → DNS over HTTPS
2. Select provider (Cloudflare recommended)

**Safari** (macOS):
1. System Settings → Network → DNS
2. Add DNS-over-HTTPS server manually

### 6.4 Disable Third-Party Cookies

Block cookies from tracking pixels:

**Chrome**:
1. Settings → Privacy and security → Cookies and data
2. Select **"Block all cookies"** (or third-party cookies minimum)

**Firefox**:
1. Preferences → Privacy & Security → Cookies and Site Data
2. Select **"Delete cookies and site data when Firefox is closed"**
3. Under Tracking content: check **"In all windows"**

**Safari**:
1. Preferences → Privacy → Cookies and website data
2. Select **"Block all cookies"**

### 6.5 Disable Supercookies & Local Storage

Prevent persistence through storage mechanisms:

**Chrome**:
1. Settings → Privacy and security → Delete browsing data
2. Check **"Cookies and other site data"**
3. Select **"All time"** from dropdown
4. Enable **"On exit"** to auto-clear

**Firefox**:
1. Preferences → Privacy & Security → History
2. Set to **"Use custom settings for history"**
3. Check **"Clear history when Firefox closes"**

### 6.6 Spoof User Agent

Hide your browser/device fingerprint:

**Chrome Extension**: [User-Agent Switcher](https://chrome.google.com/webstore)
**Firefox Add-on**: [User-Agent Switcher](https://addons.mozilla.org/en-US/firefox/addon/uaswitcher/)
**Safari**: Settings → Privacy → Website Tracking → Prevent Cross-Site Tracking ✓

---

## 7. Wallet Operational Security: Best Practices

### 7.1 Don't Reuse Wallet Addresses

Every time you receive payment for a subscription, use a unique address (this is where stealth addresses help).

**❌ BAD**:
```
Netflix payment → same_address_1
Spotify payment → same_address_1
Amazon payment → same_address_1
(All linked to one identity)
```

**✅ GOOD**:
```
Netflix payment → stealth_address_1 (unique)
Spotify payment → stealth_address_2 (unique)
Amazon payment → stealth_address_3 (unique)
(All unlinked)
```

### 7.2 Use Separate Wallets for Different Purposes

Create separate Stellar wallets for:
- **Subscriptions** (via SYNCRO)
- **Personal spending** (everyday transactions)
- **Savings** (long-term holdings)

**Why**: If one wallet is compromised, others remain secure. Chain analysis can't correlate activities across wallets.

### 7.3 Never Share Your Viewing Key

Your viewing key lets anyone see all your payments. Treat it like a password:
- ✅ Keep it encrypted (use your backup file)
- ❌ Don't paste it into websites or chat
- ❌ Don't send it via email
- ✅ Store it in a password manager

### 7.4 Verify Payments Locally

Use SYNCRO's recovery tools to verify you received payments:

1. Go to **Settings → Privacy → Stealth Recovery**
2. Enter your viewing key
3. SYNCRO scans the Stellar blockchain for your payments
4. Verify all expected payments appear

This ensures SYNCRO's database matches what's really on-chain.

### 7.5 Monitor for Unauthorized Access

Check your activity regularly:

1. **Review Payment History**: Go to **Dashboard → Payments**
   - Look for payments you didn't recognize
   - Check timestamps

2. **Verify Subscriptions**: Go to **Settings → Privacy → Verify Data**
   - Confirm all listed subscriptions are yours
   - Check encryption status

3. **Enable Alerts**: Go to **Settings → Security → Notifications**
   - Enable alerts for: New subscriptions, wallet access, payment channels
   - Choose notification method (email, SMS)

### 7.6 Rotate Encryption Keys Annually

Your metadata encryption key should be refreshed yearly:

1. Go to **Settings → Privacy → Encryption → Rotate Key**
2. Click **Generate New Key**
3. Download and secure the new key file
4. Confirm key rotation
5. SYNCRO re-encrypts all subscriptions with the new key

### 7.7 Use a Hardware Wallet (For Large Amounts)

If holding large amounts in your subscription wallet:

**Recommended**: Ledger, Trezor, or Keystone
- Keys never leave the device
- Transactions must be approved physically
- Can't be hacked remotely

**Connect to SYNCRO**: 
1. Settings → Wallet Connection
2. Select hardware wallet
3. Approve connection on device
4. Use SYNCRO normally (signing happens on device)

---

## 8. Purchasing Gift Cards Anonymously

SYNCRO enables gift card payments, which can be purchased with privacy. Here's how:

### 8.1 Via Tor Browser (Maximum Privacy)

**Step 1**: Download Tor Browser
- Visit https://www.torproject.org/download/
- Follow installation instructions
- Launch Tor Browser

**Step 2**: Access SYNCRO via Tor
- Open Tor Browser
- Visit your SYNCRO dashboard URL
- Login normally (your session is routed through Tor)

**Step 3**: Purchase gift cards through Tor
- Use no-KYC gift card providers (see 8.3 below)
- Pay with Bitcoin or Monero (not traceable to identity)
- Gift card delivered to anonymous email

**Why Tor Works**:
- Your IP address is hidden (server sees Tor exit node, not you)
- Your ISP can't see you're using SYNCRO
- Network observers can't correlate your activity

**Tor Browser Limitations in SYNCRO**:
- ⚠️ Freighter wallet extension doesn't work in Tor
- ✅ All other features work normally
- ✅ Payment channel setup works
- ✅ Subscription management works

### 8.2 Via VPN (Convenient + Private)

A VPN encrypts your traffic and hides your IP:

**Recommended VPNs**:
- **Mullvad** (free, no-logs, strong privacy)
- **Proton VPN** (free tier available)
- **IVPN** (paid, strict no-logs)
- **Private Internet Access** (affordable, audited no-logs)

**How to use**:
1. Install VPN application
2. Connect to a server in a neutral country (Switzerland, Iceland, Romania)
3. Access SYNCRO and purchase gift cards
4. ISP and servers can't see your activity

**VPN vs Tor**:
| Feature | VPN | Tor |
|---------|-----|-----|
| **Speed** | Fast | Slower |
| **Privacy** | Good | Excellent |
| **Setup** | Easy | Moderate |
| **Logs** | Trust provider | None kept |
| **Cost** | $3-15/mo | Free |

### 8.3 No-KYC Gift Card Providers

These providers don't require ID verification:

| Provider | Cards | Crypto | Privacy |
|----------|-------|--------|---------|
| **Atomic Wallet** | Visa, Amazon, Google Play | Yes | High |
| **Cake Wallet** | Steam, Netflix, Spotify | BTC, Monero | High |
| **Bitrefill** | 170+ retailers | BTC, Lightning | High |
| **Coincards** | Global retailers | BTC, Monero | High |
| **eGifter** | 200+ merchants | Various crypto | Medium |

**How to buy**:
1. Visit provider website
2. Select gift card type (Netflix, Spotify, etc.)
3. Choose payment crypto
4. Provide email for delivery
5. Send crypto from your wallet
6. Gift card arrives in email within minutes
7. Use in SYNCRO to pay for subscriptions

### 8.4 Best Practices for Anonymous Purchases

✅ **DO**:
- [ ] Use fresh Bitcoin wallet for each purchase (or Monero)
- [ ] Access through VPN or Tor
- [ ] Use anonymous email (ProtonMail, Tutanota, Guerrillamail)
- [ ] Clear browser history after purchase
- [ ] Use separate computer or VM if possible

❌ **DON'T**:
- Reuse wallet addresses across purchases
- Use your real name or email
- Link crypto from exchange to purchase wallet
- Buy multiple gift cards at once from same wallet
- Share gift card codes with anyone

---

## 9. Complete Privacy Workflow Example

Here's a full example of using SYNCRO with maximum privacy:

### Scenario: Subscribe to Netflix with complete anonymity

**Step 1: Prepare Tor + VPN**
```
1. Download Tor Browser
2. Connect VPN to a neutral country
3. Open Tor Browser (adds another layer)
4. Create anonymous email: netflix-sub@protonmail.com
```

**Step 2: Set up SYNCRO with privacy**
```
1. Access SYNCRO via Tor Browser
2. Create account with anonymous email
3. Go to Settings → Privacy
4. Enable: Stealth Addresses, Metadata Encryption, Timing Jitter
5. Generate stealth meta-address
6. Create payment channel
```

**Step 3: Purchase Netflix gift card**
```
1. Visit Bitrefill via Tor Browser
2. Select Netflix gift card
3. Choose Monero as payment
4. Provide anonymous email (netflix-sub@protonmail.com)
5. Send Monero from fresh wallet
6. Receive gift card in email
```

**Step 4: Add subscription to SYNCRO**
```
1. In SYNCRO, click "Add Subscription"
2. Name: "Netflix"
3. Price: $15.99
4. Cycle: Monthly
5. SYNCRO encrypts this metadata (you see it, server doesn't)
6. Submit
```

**Step 5: Enable privacy features**
```
1. Go to Reminders → Privacy
2. Enable Timing Jitter (±2 days, ±2 hours)
3. Payment Channel remains active (renewals off-chain)
4. Your payment appears as stealth address on blockchain
```

**Result**: 
- ✅ Netflix doesn't know you used crypto
- ✅ SYNCRO doesn't know you subscribe to Netflix
- ✅ Blockchain observers see only stealth addresses
- ✅ Renewal reminders arrive at random times
- ✅ No ISP can see your activity
- ✅ VPN/Tor provider doesn't see SYNCRO data

---

## 10. Troubleshooting Common Privacy Questions

### Q: What if I lose my encryption key backup?

**A**: You'll need to re-enter subscriptions manually. Encrypted old subscriptions become unrecoverable. Always store your key backup in multiple safe locations.

### Q: Can SYNCRO see my subscription metadata?

**A**: No, if you enable metadata encryption. Encrypted data is gibberish to SYNCRO—only your device can decrypt it. But timestamps and payment amounts are still visible to SYNCRO (needed for reminders and billing).

### Q: Is Tor Browser really necessary?

**A**: No, but it's the strongest privacy option. VPN alone provides good privacy. At minimum, use private browsing mode + VPN when accessing SYNCRO.

### Q: Can I verify my payments are really on-chain?

**A**: Yes! Use the Stealth Recovery tool:
1. Settings → Privacy → Stealth Recovery
2. Enter your viewing key
3. SYNCRO scans Stellar blockchain
4. Verify all expected payments appear

### Q: What if SYNCRO is hacked? Are my subscriptions exposed?

**A**: If metadata encryption is enabled, hackers see only encrypted gibberish. If encryption is off, subscription details would be visible. Enable encryption immediately in Settings → Privacy.

### Q: Can payment channels fail?

**A**: Payment channels use 2-of-2 multisig, so both you and SYNCRO must agree to close. If SYNCRO disappears, you can unilaterally close using the blockchain (takes longer but guaranteed).

### Q: How do I delete my data?

**A**: 
1. Go to Settings → Data & Privacy → Delete Account
2. All server-side data is permanently deleted
3. On-chain data (stealth addresses, payments) remains forever (this is blockchain)
4. Encrypted metadata becomes unreadable garbage (you needed the key anyway)

### Q: Is my VPN provider logging my activity?

**A**: Good VPN providers have audited no-logs policies. Verify before using:
- Request their privacy policy
- Check for third-party audits
- Use reputable providers (Mullvad, Proton, IVPN)

### Q: Can I use SYNCRO on a public WiFi?

**A**: Not recommended without VPN. Public WiFi is easily monitored. Always use VPN + private browsing when on public networks.

---

## 11. Privacy Checklist for Monthly Maintenance

Review these monthly to maintain maximum privacy:

- [ ] **Browser Privacy**: Check WebRTC is disabled, DNSoH enabled
- [ ] **Verify Payments**: Run Stealth Recovery to verify blockchain
- [ ] **Check Encrypted Metadata**: Confirm subscriptions are encrypted
- [ ] **Review Activity Logs**: Look for unauthorized access
- [ ] **Clear Browser Data**: Delete history, cookies, cache
- [ ] **Key Backup**: Verify encryption key backup exists in safe location
- [ ] **Payment Channel Status**: Confirm channel is active and private
- [ ] **Wallet Address Hygiene**: Verify you haven't reused addresses
- [ ] **VPN/Tor**: If using, confirm it's up-to-date
- [ ] **Timing Jitter**: Confirm reminder jitter is enabled

---

## 12. Further Resources

### SYNCRO Documentation
- [Stealth Address Specification](./stealth-addresses.md) — Technical deep dive
- [Metadata Encryption Guide](./metadata-encryption.md) — How encryption works
- [Payment Channel Protocol](./payment-channel-protocol.md) — Recurring payments

### Privacy Tools & Standards
- [Tor Project](https://www.torproject.org/) — Privacy networking
- [Mullvad VPN](https://mullvad.net/) — Privacy-focused VPN
- [EFF's Surveillance Self-Defense](https://ssd.eff.org/) — Privacy guide
- [OWASP Privacy Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Privacy_Cheat_Sheet.html)

### Blockchain Privacy
- [Stellar Ledger](https://stellar.expert/) — View transactions on-chain
- [ECDH Explained](https://en.wikipedia.org/wiki/Elliptic_curve_Diffie%E2%80%93Hellman) — How stealth addresses work
- [Zero-Knowledge Proofs](https://en.wikipedia.org/wiki/Zero-knowledge_proof) — Verify without revealing

### No-KYC Resources
- [KYC Not Me](https://kycnotme.com/) — Privacy-friendly service list
- [Cake Wallet](https://cakewallet.com/) — Anonymous crypto wallet
- [Monero Project](https://www.monero.org/) — Private cryptocurrency

---

## Questions or Concerns?

If you have privacy questions or find a gap in this guide:

1. **Security Issues**: Email security@syncro.dev
2. **Privacy Questions**: Email privacy@syncro.dev
3. **Bug Reports**: Open issue on GitHub (privacyguide)
4. **Feature Requests**: Discuss on SYNCRO community forums

---

**Last Updated**: June 26, 2026
**Version**: 1.0
**Status**: User-Facing (Non-Technical)

*This guide is for educational purposes. Privacy depends on your implementation choices. SYNCRO provides the tools; you decide how to use them.*
