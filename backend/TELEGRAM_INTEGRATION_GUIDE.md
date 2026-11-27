# Telegram Integration Guide

## Quick Start

### 1. Create a Telegram Bot

1. Open Telegram and search for [@BotFather](https://t.me/botfather)
2. Send `/newbot` command
3. Choose a name for your bot (e.g., "SYNCRO Notifications")
4. Choose a username (must end in 'bot', e.g., "syncro_notifications_bot")
5. Copy the bot token provided by BotFather

### 2. Configure Environment

Add to your `.env` file:

```bash
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
FRONTEND_URL=https://syncro.app
```

### 3. Run Database Migration

```bash
cd backend
npm run db:migrate
```

This creates the `user_telegram_connections` table.

### 4. Set Webhook

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://api.syncro.app/api/telegram/webhook"}'
```

### 5. Test Connection

```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getMe"
```

Expected response:
```json
{
  "ok": true,
  "result": {
    "id": 1234567890,
    "is_bot": true,
    "first_name": "SYNCRO Notifications",
    "username": "syncro_notifications_bot"
  }
}
```

---

## User Connection Flow

### Frontend Implementation

1. **Generate Deep Link:**

```typescript
// In user settings page
const connectTelegram = async () => {
  const userId = user.id;
  const encodedUserId = btoa(userId); // Base64 encode
  const botUsername = 'syncro_notifications_bot';
  const deepLink = `https://t.me/${botUsername}?start=${encodedUserId}`;
  
  // Open in new window or show QR code
  window.open(deepLink, '_blank');
};
```

2. **Check Connection Status:**

```typescript
const checkTelegramConnection = async () => {
  const { data, error } = await supabase
    .from('user_telegram_connections')
    .select('*')
    .eq('user_id', user.id)
    .single();
  
  return !!data && !error;
};
```

3. **Disconnect:**

```typescript
const disconnectTelegram = async () => {
  const { error } = await supabase
    .from('user_telegram_connections')
    .delete()
    .eq('user_id', user.id);
  
  if (!error) {
    // Show success message
    // User should also send /disconnect to bot
  }
};
```

---

## Backend Usage

### Send Renewal Reminder

```typescript
import { telegramBotService } from './services/telegram-bot-service';

const result = await telegramBotService.sendRenewalReminder(
  userId,
  {
    title: 'Renewal Reminder',
    body: 'Your subscription renews soon',
    subscription: subscriptionData,
    reminderType: 'renewal',
    daysBefore: 3,
    renewalDate: '2026-05-27',
    priority: 'normal',
  }
);

if (result.success) {
  console.log('Message sent:', result.metadata?.messageId);
} else {
  console.error('Failed to send:', result.error);
}
```

### Send Simple Message

```typescript
const result = await telegramBotService.sendSimpleMessage(
  userId,
  '<b>Hello!</b> This is a test message.',
  chatId // Optional, will lookup if not provided
);
```

### Send Risk Alert

```typescript
const result = await telegramBotService.sendRiskAlert(
  userId,
  {
    subscriptionName: 'Netflix',
    riskFactors: [
      { factor_type: 'consecutive_failures', details: { count: 3 } },
      { factor_type: 'balance_projection', details: {} },
    ],
    renewalDate: '2026-05-27',
    recommendedAction: 'Update payment method',
  }
);
```

### Check if Configured

```typescript
if (telegramBotService.isConfigured()) {
  // Send notifications
} else {
  console.warn('Telegram not configured');
}
```

### Verify Connection

```typescript
const isConnected = await telegramBotService.verifyConnection();
if (isConnected) {
  console.log('Bot is connected to Telegram API');
}
```

---

## Message Formatting

### HTML Tags Supported

- `<b>bold</b>` - Bold text
- `<i>italic</i>` - Italic text
- `<code>code</code>` - Monospace code
- `<pre>preformatted</pre>` - Preformatted block
- `<a href="url">link</a>` - Hyperlink

### Emojis

Use Unicode emojis directly in strings:
- 🔔 - Bell (normal priority)
- ⚠️ - Warning (medium priority)
- 🚨 - Alert (high priority)
- 📅 - Calendar
- 💰 - Money
- 📦 - Package

### Example Message

```typescript
const message = `
🔔 <b>Subscription Renewal in 3 days</b>

<b>Netflix</b>
📦 Category: Streaming
💰 Price: $15.99/monthly
📅 Renewal: May 27, 2026
⏰ Days remaining: 3
`;
```

---

## Inline Buttons

### Add Buttons to Message

```typescript
const buttons = {
  inline_keyboard: [
    [
      { text: '🔗 Manage Subscription', url: 'https://netflix.com/account' },
    ],
    [
      { text: '📱 View in SYNCRO', url: 'https://syncro.app/dashboard' },
    ],
  ],
};

await telegramBotService.sendMessage(chatId, message, {
  parseMode: 'HTML',
  replyMarkup: buttons,
});
```

---

## Error Handling

### Non-Retryable Errors

These errors will NOT be retried:
- Bot blocked by user (403)
- Chat not found (400)
- Invalid bot token (401)
- Bad request (400)

```typescript
const result = await telegramBotService.sendRenewalReminder(userId, payload);

if (!result.success && result.metadata?.retryable === false) {
  // Permanent failure - don't retry
  // Consider removing user's Telegram connection
  await supabase
    .from('user_telegram_connections')
    .delete()
    .eq('user_id', userId);
}
```

### Retryable Errors

These errors WILL be retried with exponential backoff:
- Rate limit (429)
- Server error (500, 502, 503, 504)
- Network timeout
- Connection refused

```typescript
const result = await telegramBotService.sendRenewalReminder(
  userId,
  payload,
  undefined,
  { maxAttempts: 5 } // Retry up to 5 times
);
```

---

## Database Queries

### Get User's Telegram Connection

```typescript
const { data, error } = await supabase
  .from('user_telegram_connections')
  .select('*')
  .eq('user_id', userId)
  .single();

if (data) {
  console.log('Chat ID:', data.chat_id);
  console.log('Username:', data.username);
  console.log('Connected at:', data.connected_at);
}
```

### List All Connections

```typescript
const { data, error } = await supabase
  .from('user_telegram_connections')
  .select('*')
  .order('connected_at', { ascending: false });
```

### Check if User is Connected

```typescript
const { count, error } = await supabase
  .from('user_telegram_connections')
  .select('*', { count: 'exact', head: true })
  .eq('user_id', userId);

const isConnected = count > 0;
```

---

## Webhook Commands

### Supported Commands

1. **`/start <deep_link_param>`** - Connect account
2. **`/disconnect`** - Disconnect account
3. **`/help`** - Show help message

### Testing Webhook Locally

Use ngrok to expose local server:

```bash
ngrok http 3001
```

Set webhook to ngrok URL:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://abc123.ngrok.io/api/telegram/webhook"}'
```

### Webhook Payload Example

```json
{
  "update_id": 123456789,
  "message": {
    "message_id": 1,
    "from": {
      "id": 987654321,
      "is_bot": false,
      "first_name": "John",
      "last_name": "Doe",
      "username": "johndoe"
    },
    "chat": {
      "id": 987654321,
      "first_name": "John",
      "last_name": "Doe",
      "username": "johndoe",
      "type": "private"
    },
    "date": 1714176000,
    "text": "/start dXNlci0xMjM="
  }
}
```

---

## Monitoring

### Check Webhook Status

```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo"
```

Response:
```json
{
  "ok": true,
  "result": {
    "url": "https://api.syncro.app/api/telegram/webhook",
    "has_custom_certificate": false,
    "pending_update_count": 0,
    "last_error_date": 0,
    "max_connections": 40
  }
}
```

### View Logs

```bash
# All Telegram logs
grep "TelegramBotService" logs/combined.log

# Errors only
grep "TelegramBotService.*error" logs/error.log

# Webhook logs
grep "TelegramWebhook" logs/combined.log
```

### Database Metrics

```sql
-- Total connections
SELECT COUNT(*) FROM user_telegram_connections;

-- Connections by day
SELECT DATE(connected_at), COUNT(*) 
FROM user_telegram_connections 
GROUP BY DATE(connected_at) 
ORDER BY DATE(connected_at) DESC;

-- Recent connections
SELECT * FROM user_telegram_connections 
ORDER BY connected_at DESC 
LIMIT 10;
```

---

## Troubleshooting

### Bot Not Responding

**Problem:** Bot doesn't respond to commands

**Solutions:**
1. Check bot token is correct
2. Verify webhook is set correctly
3. Check webhook URL is accessible
4. Review webhook logs for errors

```bash
# Check bot info
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getMe"

# Check webhook
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo"

# Test webhook endpoint
curl https://api.syncro.app/api/telegram/webhook
```

### Messages Not Sending

**Problem:** Reminders not delivered to Telegram

**Solutions:**
1. Check user has connected Telegram account
2. Verify bot token is configured
3. Check notification preferences include 'telegram'
4. Review logs for errors

```sql
-- Check user connection
SELECT * FROM user_telegram_connections WHERE user_id = '<user_id>';

-- Check notification preferences
SELECT notification_channels FROM user_preferences WHERE user_id = '<user_id>';

-- Check delivery records
SELECT * FROM notification_deliveries 
WHERE user_id = '<user_id>' AND channel = 'telegram' 
ORDER BY created_at DESC;
```

### Rate Limiting

**Problem:** Too many requests error (429)

**Solutions:**
1. Implement exponential backoff (already done)
2. Batch notifications if possible
3. Spread out delivery times
4. Monitor rate limit headers

```typescript
// Already implemented in service
const result = await telegramBotService.sendRenewalReminder(
  userId,
  payload,
  undefined,
  { maxAttempts: 3 } // Will retry with backoff
);
```

### Webhook Not Receiving Updates

**Problem:** Webhook endpoint not receiving POST requests

**Solutions:**
1. Verify webhook URL is publicly accessible
2. Check SSL certificate is valid
3. Ensure endpoint returns 200 status
4. Review server logs for errors

```bash
# Delete webhook
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/deleteWebhook"

# Set webhook again
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://api.syncro.app/api/telegram/webhook"}'

# Verify
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo"
```

---

## Best Practices

### 1. Always Check Configuration

```typescript
if (!telegramBotService.isConfigured()) {
  logger.warn('Telegram not configured, skipping notification');
  return;
}
```

### 2. Handle Errors Gracefully

```typescript
const result = await telegramBotService.sendRenewalReminder(userId, payload);

if (!result.success) {
  logger.error('Failed to send Telegram notification:', result.error);
  
  // Fall back to email if Telegram fails
  if (result.metadata?.retryable === false) {
    await emailService.sendReminderEmail(userEmail, payload);
  }
}
```

### 3. Log with Context

```typescript
logger.info('Sending Telegram notification', {
  userId,
  subscriptionId: payload.subscription.id,
  reminderType: payload.reminderType,
  daysBefore: payload.daysBefore,
});
```

### 4. Validate User Input

```typescript
// In webhook handler
const deepLinkParam = parts[1];
if (!deepLinkParam || deepLinkParam.length > 100) {
  logger.warn('Invalid deep link parameter');
  return;
}

const userId = Buffer.from(deepLinkParam, 'base64').toString('utf-8');
if (!userId || !userId.match(/^[a-f0-9-]{36}$/)) {
  logger.warn('Invalid user ID format');
  return;
}
```

### 5. Use Transactions for Critical Operations

```typescript
// When creating connection
const { data, error } = await supabase.rpc('create_telegram_connection', {
  p_user_id: userId,
  p_chat_id: chatId,
  p_username: username,
  p_first_name: firstName,
  p_last_name: lastName,
});
```

---

## Security Considerations

### 1. Validate Webhook Requests

Consider adding webhook secret validation:

```typescript
// In webhook handler
const secret = req.headers['x-telegram-bot-api-secret-token'];
if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
  return res.status(403).json({ error: 'Invalid secret' });
}
```

### 2. Rate Limit Webhook Endpoint

```typescript
import rateLimit from 'express-rate-limit';

const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
});

app.use('/api/telegram/webhook', webhookLimiter);
```

### 3. Sanitize User Input

```typescript
// Already implemented
import { sanitizeUrl } from '../utils/sanitize-url';

const safeUrl = sanitizeUrl(subscription.renewal_url);
```

### 4. Use Row-Level Security

```sql
-- Already implemented in migration
CREATE POLICY "telegram_connections_select_own"
  ON user_telegram_connections FOR SELECT
  USING (auth.uid() = user_id);
```

---

## Performance Optimization

### 1. Cache Chat IDs

```typescript
// In-memory cache for frequently accessed chat IDs
const chatIdCache = new Map<string, string>();

async function getCachedChatId(userId: string): Promise<string | null> {
  if (chatIdCache.has(userId)) {
    return chatIdCache.get(userId)!;
  }
  
  const chatId = await getChatIdForUser(userId);
  if (chatId) {
    chatIdCache.set(userId, chatId);
  }
  
  return chatId;
}
```

### 2. Batch Notifications

```typescript
// Send multiple notifications in parallel
const results = await Promise.allSettled(
  userIds.map(userId => 
    telegramBotService.sendRenewalReminder(userId, payload)
  )
);
```

### 3. Use Connection Pooling

Already implemented in `backend/src/config/database.ts`

---

## Additional Resources

- [Telegram Bot API Documentation](https://core.telegram.org/bots/api)
- [BotFather Commands](https://core.telegram.org/bots#6-botfather)
- [Telegram Bot Best Practices](https://core.telegram.org/bots/best-practices)
- [HTML Formatting Guide](https://core.telegram.org/bots/api#html-style)

---

**Last Updated:** April 27, 2026  
**Version:** 1.0.0  
**Maintainer:** SYNCRO Development Team

---

## Interactive Commands (Issue #652)

Beyond reminder delivery, the bot supports interactive commands for querying and managing subscriptions directly from Telegram.

### Available Commands

| Command | Description | Required Role |
|---|---|---|
| `/subs` | List all active subscriptions with monthly cost | Any linked account |
| `/renewals` | Show upcoming renewals in the next 30 days | Any linked account (viewer+) |
| `/snooze <N> <days>` | Snooze reminder for renewal #N by N days | member, admin, or owner |
| `/start <token>` | Connect SYNCRO account | — |
| `/disconnect` | Unlink Telegram account | — |
| `/help` | Show help | — |

### Querying Upcoming Renewals

Send `/renewals` to get a numbered list of subscriptions renewing in the next 30 days: