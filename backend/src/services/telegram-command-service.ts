import { Telegraf, Context } from 'telegraf';
import { randomUUID } from 'crypto';
import logger from '../config/logger';
import { supabase, trackDbRequest } from '../config/database';
import { Subscription } from '../types/subscription';
import { UserRole } from '../middleware/auth';
import { ROLE_PERMISSIONS } from '../middleware/rbac';
import { roleService } from './role-service';
import { normalizeToMonthlyAmount } from '@syncro/shared/subscription-math';

// ─── Constants ────────────────────────────────────────────────────────────────

const UPCOMING_RENEWAL_DAYS = 30;
const SNOOZE_MAX_DAYS = 30;
const RENEWAL_CONTEXT_TTL_MS = 5 * 60 * 1_000; // 5 minutes

// ─── Monthly Cost Normalisation ───────────────────────────────────────────────

export function toMonthlyAmount(price: number, cycle: Subscription['billing_cycle']): number {
  return normalizeToMonthlyAmount(price, cycle);
}

// ─── Formatting ───────────────────────────────────────────────────────────────

export function formatSubsList(subs: Subscription[]): string {
  const lines = subs.map((s) => {
    const monthly = toMonthlyAmount(s.price, s.billing_cycle);
    return `• *${escapeMarkdown(s.name)}* — ${s.currency} ${monthly.toFixed(2)}/mo`;
  });

  const total = subs.reduce(
    (sum, s) => sum + toMonthlyAmount(s.price, s.billing_cycle),
    0
  );

  const currencies = [...new Set(subs.map((s) => s.currency))];
  let totalLine: string;

  if (currencies.length === 1) {
    totalLine = `\n💳 *Total:* ${currencies[0]} ${total.toFixed(2)}/mo`;
  } else {
    const perCurrency = currencies.map((cur) => {
      const curTotal = subs
        .filter((s) => s.currency === cur)
        .reduce((sum, s) => sum + toMonthlyAmount(s.price, s.billing_cycle), 0);
      return `${cur} ${curTotal.toFixed(2)}`;
    });
    totalLine = `\n💳 *Total:* ${perCurrency.join(' + ')}/mo`;
  }

  return (
    `📋 *Your Active Subscriptions* (${subs.length})\n\n` +
    lines.join('\n') +
    totalLine
  );
}

export interface UpcomingRenewal {
  subId: string;
  name: string;
  price: number;
  currency: string;
  billing_cycle: Subscription['billing_cycle'];
  next_billing_date: string;
  daysUntil: number;
}

export function formatRenewalsList(renewals: UpcomingRenewal[]): string {
  if (renewals.length === 0) {
    return '📭 No upcoming renewals in the next 30 days.';
  }

  const lines = renewals.map((r, i) => {
    const dateStr = new Date(r.next_billing_date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    const dayLabel =
      r.daysUntil === 0 ? 'today' : r.daysUntil === 1 ? 'tomorrow' : `in ${r.daysUntil}d`;
    return `*${i + 1}.* ${escapeMarkdown(r.name)} — ${r.currency} ${r.price.toFixed(2)} (${dateStr}, ${dayLabel})`;
  });

  return (
    `📅 *Upcoming Renewals* (next ${UPCOMING_RENEWAL_DAYS} days)\n\n` +
    lines.join('\n') +
    `\n\n_To snooze a reminder, reply_ /snooze \\<N\\> \\<days\\>`
  );
}

/** Escape characters that have special meaning in Telegram Markdown v1. */
function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}

// ─── In-memory renewal context (chat → last /renewals result) ─────────────────
// Lets /snooze reference the numbered list from the previous /renewals reply.
// Exported for tests.

export const renewalContextStore = new Map<string, UpcomingRenewal[]>();
const _renewalContextTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function setRenewalContext(chatId: string, renewals: UpcomingRenewal[]): void {
  const prev = _renewalContextTimers.get(chatId);
  if (prev) clearTimeout(prev);
  renewalContextStore.set(chatId, renewals);
  const timer = setTimeout(() => {
    renewalContextStore.delete(chatId);
    _renewalContextTimers.delete(chatId);
  }, RENEWAL_CONTEXT_TTL_MS);
  _renewalContextTimers.set(chatId, timer);
}

export function getRenewalContext(chatId: string): UpcomingRenewal[] | null {
  return renewalContextStore.get(chatId) ?? null;
}

// ─── RBAC Helpers ─────────────────────────────────────────────────────────────

/** Returns true when the role grants the given permission string. */
export function roleHasPermission(role: UserRole, permission: string): boolean {
  const perms = ROLE_PERMISSIONS[role] ?? [];
  if (perms.includes('*')) return true;
  const [reqNs, reqAction] = permission.split(':');
  return perms.some((p) => {
    const [ns, action] = p.split(':');
    return ns === reqNs && (action === '*' || action === reqAction);
  });
}

// ─── DB Helpers ───────────────────────────────────────────────────────────────

export async function getUserIdByChatId(chatId: string): Promise<string | null> {
  const release = trackDbRequest();
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('telegram_chat_id', chatId)
      .single();

    if (error || !data?.id) return null;
    return data.id as string;
  } finally {
    release();
  }
}

export async function getActiveSubscriptions(userId: string): Promise<Subscription[]> {
  const release = trackDbRequest();
  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('id, name, price, currency, billing_cycle, status')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('name', { ascending: true });

    if (error) throw error;
    return (data as Subscription[]) ?? [];
  } finally {
    release();
  }
}

export async function getUpcomingRenewals(userId: string): Promise<UpcomingRenewal[]> {
  const release = trackDbRequest();
  try {
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() + UPCOMING_RENEWAL_DAYS);

    const { data, error } = await supabase
      .from('subscriptions')
      .select('id, name, price, currency, billing_cycle, next_billing_date')
      .eq('user_id', userId)
      .eq('status', 'active')
      .not('next_billing_date', 'is', null)
      .gte('next_billing_date', now.toISOString().split('T')[0])
      .lte('next_billing_date', cutoff.toISOString().split('T')[0])
      .order('next_billing_date', { ascending: true });

    if (error) throw error;

    const today = now.toISOString().split('T')[0];
    return ((data ?? []) as Array<{
      id: string;
      name: string;
      price: number;
      currency: string;
      billing_cycle: Subscription['billing_cycle'];
      next_billing_date: string;
    }>).map((row) => {
      const diffMs =
        new Date(row.next_billing_date).getTime() - new Date(today).getTime();
      const daysUntil = Math.round(diffMs / (1000 * 60 * 60 * 24));
      return {
        subId: row.id,
        name: row.name,
        price: row.price,
        currency: row.currency,
        billing_cycle: row.billing_cycle,
        next_billing_date: row.next_billing_date,
        daysUntil,
      };
    });
  } finally {
    release();
  }
}

/**
 * Snooze reminders for `subId` until `snoozeDays` from now.
 * Sets `muted = true` and `muted_until` on subscription_notification_preferences.
 * Upserts the row if it doesn't exist.
 */
export async function snoozeRenewalReminder(
  userId: string,
  subId: string,
  snoozeDays: number
): Promise<void> {
  const release = trackDbRequest();
  try {
    const mutedUntil = new Date();
    mutedUntil.setDate(mutedUntil.getDate() + snoozeDays);

    const { error } = await supabase
      .from('subscription_notification_preferences')
      .upsert(
        {
          subscription_id: subId,
          user_id: userId,
          muted: true,
          muted_until: mutedUntil.toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'subscription_id,user_id' }
      );

    if (error) throw error;
  } finally {
    release();
  }
}

// ─── Command Handlers ─────────────────────────────────────────────────────────

export async function handleSubsCommand(ctx: Context): Promise<void> {
  const requestId = randomUUID();
  const chatId = String(ctx.chat?.id);

  logger.info('[TelegramCommandService] /subs command received', { requestId, chatId });

  let userId: string | null;
  try {
    userId = await getUserIdByChatId(chatId);
  } catch (err) {
    logger.error('[TelegramCommandService] DB error looking up user', {
      requestId,
      chatId,
      error: (err as Error).message,
    });
    await ctx.reply('⚠️ Something went wrong. Please try again later.');
    return;
  }

  if (!userId) {
    await ctx.reply(
      '🔗 Your Telegram account is not linked to a SYNCRO account.\n\n' +
        'Log in to SYNCRO and connect Telegram in your notification settings.'
    );
    return;
  }

  let subs: Subscription[];
  try {
    subs = await getActiveSubscriptions(userId);
  } catch (err) {
    logger.error('[TelegramCommandService] DB error fetching subscriptions', {
      requestId,
      userId,
      error: (err as Error).message,
    });
    await ctx.reply('⚠️ Could not load your subscriptions. Please try again later.');
    return;
  }

  if (subs.length === 0) {
    await ctx.reply('📭 You have no active subscriptions tracked in SYNCRO.');
    return;
  }

  const message = formatSubsList(subs);
  await ctx.reply(message, { parse_mode: 'Markdown' });

  logger.info('[TelegramCommandService] /subs reply sent', {
    requestId,
    userId,
    count: subs.length,
  });
}

export async function handleRenewalsCommand(ctx: Context): Promise<void> {
  const requestId = randomUUID();
  const chatId = String(ctx.chat?.id);

  logger.info('[TelegramCommandService] /renewals command received', { requestId, chatId });

  // ── Account-linking check ────────────────────────────────────────────────
  let userId: string | null;
  try {
    userId = await getUserIdByChatId(chatId);
  } catch (err) {
    logger.error('[TelegramCommandService] DB error looking up user for /renewals', {
      requestId,
      chatId,
      error: (err as Error).message,
    });
    await ctx.reply('⚠️ Something went wrong. Please try again later.');
    return;
  }

  if (!userId) {
    await ctx.reply(
      '🔗 Your Telegram account is not linked to a SYNCRO account.\n\n' +
        'Log in to SYNCRO and connect Telegram in your notification settings.'
    );
    return;
  }

  // ── RBAC: subscriptions:read required (all linked roles qualify) ──────────
  let role: UserRole;
  try {
    role = await roleService.getUserRole(userId);
  } catch (err) {
    logger.error('[TelegramCommandService] DB error fetching role for /renewals', {
      requestId,
      userId,
      error: (err as Error).message,
    });
    await ctx.reply('⚠️ Could not verify your permissions. Please try again later.');
    return;
  }

  if (!roleHasPermission(role, 'subscriptions:read')) {
    await ctx.reply('🚫 You do not have permission to view subscription data.');
    return;
  }

  // ── Fetch upcoming renewals ───────────────────────────────────────────────
  let renewals: UpcomingRenewal[];
  try {
    renewals = await getUpcomingRenewals(userId);
  } catch (err) {
    logger.error('[TelegramCommandService] DB error fetching renewals', {
      requestId,
      userId,
      error: (err as Error).message,
    });
    await ctx.reply('⚠️ Could not load your upcoming renewals. Please try again later.');
    return;
  }

  // Store context so /snooze can reference the numbered list
  setRenewalContext(chatId, renewals);

  const message = formatRenewalsList(renewals);
  await ctx.reply(message, { parse_mode: 'Markdown' });

  logger.info('[TelegramCommandService] /renewals reply sent', {
    requestId,
    userId,
    count: renewals.length,
  });
}

export async function handleSnoozeCommand(ctx: Context): Promise<void> {
  const requestId = randomUUID();
  const chatId = String(ctx.chat?.id);

  logger.info('[TelegramCommandService] /snooze command received', { requestId, chatId });

  // ── Parse arguments: /snooze <N> <days> ───────────────────────────────────
  const text = 'text' in (ctx.message ?? {}) ? (ctx.message as any).text as string : '';
  const parts = text.trim().split(/\s+/);

  if (parts.length !== 3) {
    await ctx.reply(
      '⚠️ Usage: /snooze \\<N\\> \\<days\\>\n\n' +
        '_N_ is the renewal number from /renewals\n' +
        '_days_ is how many days to snooze (1–30)',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const itemIndex = parseInt(parts[1], 10);
  const snoozeDays = parseInt(parts[2], 10);

  if (
    isNaN(itemIndex) ||
    itemIndex < 1 ||
    isNaN(snoozeDays) ||
    snoozeDays < 1 ||
    snoozeDays > SNOOZE_MAX_DAYS
  ) {
    await ctx.reply(
      `⚠️ Invalid arguments.\n\n` +
        `• N must be a positive number from your /renewals list\n` +
        `• days must be between 1 and ${SNOOZE_MAX_DAYS}`
    );
    return;
  }

  // ── Account-linking check ─────────────────────────────────────────────────
  let userId: string | null;
  try {
    userId = await getUserIdByChatId(chatId);
  } catch (err) {
    logger.error('[TelegramCommandService] DB error looking up user for /snooze', {
      requestId,
      chatId,
      error: (err as Error).message,
    });
    await ctx.reply('⚠️ Something went wrong. Please try again later.');
    return;
  }

  if (!userId) {
    await ctx.reply(
      '🔗 Your Telegram account is not linked to a SYNCRO account.\n\n' +
        'Log in to SYNCRO and connect Telegram in your notification settings.'
    );
    return;
  }

  // ── RBAC: snooze is a write action; viewer role is read-only ─────────────
  let role: UserRole;
  try {
    role = await roleService.getUserRole(userId);
  } catch (err) {
    logger.error('[TelegramCommandService] DB error fetching role for /snooze', {
      requestId,
      userId,
      error: (err as Error).message,
    });
    await ctx.reply('⚠️ Could not verify your permissions. Please try again later.');
    return;
  }

  if (role === 'viewer') {
    await ctx.reply(
      '🚫 Viewer accounts cannot snooze reminders. Contact the account owner to change your role.'
    );
    return;
  }

  // ── Resolve subscription from context ────────────────────────────────────
  const context = getRenewalContext(chatId);
  if (!context || context.length === 0) {
    await ctx.reply(
      '⚠️ No renewal list found. Please run /renewals first, then use /snooze within 5 minutes.'
    );
    return;
  }

  if (itemIndex > context.length) {
    await ctx.reply(
      `⚠️ Item #${itemIndex} not found. Your /renewals list has ${context.length} item${context.length === 1 ? '' : 's'}.`
    );
    return;
  }

  const target = context[itemIndex - 1];

  // ── Snooze ────────────────────────────────────────────────────────────────
  try {
    await snoozeRenewalReminder(userId, target.subId, snoozeDays);
  } catch (err) {
    logger.error('[TelegramCommandService] DB error snoozing reminder', {
      requestId,
      userId,
      subId: target.subId,
      error: (err as Error).message,
    });
    await ctx.reply('⚠️ Could not snooze the reminder. Please try again later.');
    return;
  }

  const until = new Date();
  until.setDate(until.getDate() + snoozeDays);
  const untilStr = until.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  await ctx.reply(
    `✅ Reminder for *${escapeMarkdown(target.name)}* snoozed for ${snoozeDays} day${snoozeDays === 1 ? '' : 's'} (until ${untilStr}).`,
    { parse_mode: 'Markdown' }
  );

  logger.info('[TelegramCommandService] /snooze applied', {
    requestId,
    userId,
    subId: target.subId,
    subName: target.name,
    snoozeDays,
  });
}

export async function handleStatusCommand(ctx: Context): Promise<void> {
  const requestId = randomUUID();
  const chatId = String(ctx.chat?.id);

  logger.info('[TelegramCommandService] /status command received', { requestId, chatId });

  let userId: string | null;
  try {
    userId = await getUserIdByChatId(chatId);
  } catch (err) {
    logger.error('[TelegramCommandService] DB error looking up user for /status', {
      requestId,
      chatId,
      error: (err as Error).message,
    });
    await ctx.reply('⚠️ Something went wrong. Please try again later.');
    return;
  }

  if (!userId) {
    await ctx.reply(
      '🔗 Your Telegram account is not linked to a SYNCRO account.\n\n' +
        'Log in to SYNCRO and connect Telegram in your notification settings.',
    );
    return;
  }

  let subs: Subscription[];
  let renewals: UpcomingRenewal[];
  try {
    [subs, renewals] = await Promise.all([
      getActiveSubscriptions(userId),
      getUpcomingRenewals(userId),
    ]);
  } catch (err) {
    logger.error('[TelegramCommandService] DB error fetching status', {
      requestId,
      userId,
      error: (err as Error).message,
    });
    await ctx.reply('⚠️ Could not load your subscription overview. Please try again later.');
    return;
  }

  const totalMonthly = subs.reduce(
    (sum, s) => sum + toMonthlyAmount(s.price, s.billing_cycle),
    0,
  );
  const currency = subs[0]?.currency ?? 'USD';
  const nextRenewal = renewals[0];

  let message = '📊 <b>Subscription Overview</b>\n\n';
  message += `📦 Active: <b>${subs.length}</b>\n`;
  message += `💳 Monthly spend: <b>${currency} ${totalMonthly.toFixed(2)}</b>\n`;
  message += `📅 Upcoming renewals (30d): <b>${renewals.length}</b>\n`;

  if (nextRenewal) {
    const dateStr = new Date(nextRenewal.next_billing_date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    message += `\n⏭ Next: <b>${nextRenewal.name}</b> on ${dateStr}`;
  }

  message += '\n\n_Use /renewals for the full list or /snooze to pause reminders._';

  await ctx.reply(message, { parse_mode: 'HTML' });

  logger.info('[TelegramCommandService] /status reply sent', { requestId, userId });
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class TelegramCommandService {
  private bot: Telegraf | null = null;

  /** Initialises the Telegraf bot and registers command handlers. */
  init(): Telegraf | null {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      logger.warn(
        '[TelegramCommandService] TELEGRAM_BOT_TOKEN not set — command bot disabled'
      );
      return null;
    }

    this.bot = new Telegraf(token);
    this.bot.command('subs', handleSubsCommand);
    this.bot.command('renewals', handleRenewalsCommand);
    this.bot.command('snooze', handleSnoozeCommand);
    this.bot.command('status', handleStatusCommand);

    logger.info('[TelegramCommandService] Command handlers registered');
    return this.bot;
  }

  /** Returns the underlying Telegraf instance (null if not initialised). */
  getBot(): Telegraf | null {
    return this.bot;
  }

  /**
   * Starts long-polling. Use this only in development/environments without a
   * public HTTPS URL for webhooks.
   */
  async startPolling(): Promise<void> {
    if (!this.bot) return;
    await this.bot.launch();
    logger.info('[TelegramCommandService] Long-polling started');
  }

  /** Gracefully stops polling. */
  stop(): void {
    this.bot?.stop();
  }
}

export const telegramCommandService = new TelegramCommandService();

// Exported for unit tests
export {
  handleSubsCommand,
  formatSubsList,
  toMonthlyAmount,
  getUserIdByChatId,
  getActiveSubscriptions,
};
