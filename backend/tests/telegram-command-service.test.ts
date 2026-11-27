import {
  formatSubsList,
  formatRenewalsList,
  toMonthlyAmount,
  roleHasPermission,
  renewalContextStore,
  setRenewalContext,
  getRenewalContext,
  UpcomingRenewal,
} from '../src/services/telegram-command-service';
import { Subscription } from '../src/types/subscription';

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

var mockSingle = jest.fn();
var mockOrder = jest.fn(() => ({ single: mockSingle }));
var mockEqStatus = jest.fn(() => ({ order: mockOrder }));
var mockEqUser = jest.fn(() => ({ eq: mockEqStatus, single: mockSingle, order: mockOrder }));
var mockSelect = jest.fn(() => ({ eq: mockEqUser }));
var mockFrom = jest.fn(() => ({ select: mockSelect }));
var mockTrackDbRequest = jest.fn(() => jest.fn());

jest.mock('../src/config/database', () => ({
  get supabase() { return { from: mockFrom }; },
  get trackDbRequest() { return mockTrackDbRequest; },
}));

var mockGetUserRole = jest.fn();
jest.mock('../src/services/role-service', () => ({
  roleService: { getUserRole: (...args: any[]) => mockGetUserRole(...args) },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub-1',
    user_id: 'user-1',
    email_account_id: null,
    merchant_id: null,
    name: 'Netflix',
    provider: 'Netflix',
    price: 15,
    currency: 'USD',
    billing_cycle: 'monthly',
    status: 'active',
    next_billing_date: null,
    category: null,
    logo_url: null,
    website_url: null,
    renewal_url: null,
    notes: null,
    visibility: 'private',
    tags: [],
    expired_at: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    paused_at: null,
    resume_at: null,
    pause_reason: null,
    last_interaction_at: null,
    ...overrides,
  };
}

function makeRenewal(overrides: Partial<UpcomingRenewal> = {}): UpcomingRenewal {
  return {
    subId: 'sub-1',
    name: 'Netflix',
    price: 15,
    currency: 'USD',
    billing_cycle: 'monthly',
    next_billing_date: '2026-06-10',
    daysUntil: 13,
    ...overrides,
  };
}

function makeCtx(chatId: number | undefined, text = '', replyFn = jest.fn()): any {
  return {
    chat: chatId !== undefined ? { id: chatId } : undefined,
    message: { text },
    reply: replyFn,
  };
}

// ─── toMonthlyAmount ─────────────────────────────────────────────────────────

describe('toMonthlyAmount', () => {
  it('returns the price unchanged for monthly billing', () => {
    expect(toMonthlyAmount(15, 'monthly')).toBe(15);
  });

  it('divides by 12 for yearly billing', () => {
    expect(toMonthlyAmount(120, 'yearly')).toBe(10);
  });

  it('divides by 3 for quarterly billing', () => {
    expect(toMonthlyAmount(30, 'quarterly')).toBe(10);
  });
});

// ─── roleHasPermission ────────────────────────────────────────────────────────

describe('roleHasPermission', () => {
  it('grants owner all permissions', () => {
    expect(roleHasPermission('owner', 'subscriptions:read')).toBe(true);
    expect(roleHasPermission('owner', 'subscriptions:write')).toBe(true);
    expect(roleHasPermission('owner', 'anything:else')).toBe(true);
  });

  it('grants admin subscriptions:* via wildcard namespace', () => {
    expect(roleHasPermission('admin', 'subscriptions:read')).toBe(true);
    expect(roleHasPermission('admin', 'subscriptions:write')).toBe(true);
  });

  it('grants member subscriptions:read', () => {
    expect(roleHasPermission('member', 'subscriptions:read')).toBe(true);
  });

  it('grants viewer subscriptions:read', () => {
    expect(roleHasPermission('viewer', 'subscriptions:read')).toBe(true);
  });

  it('denies viewer subscriptions:write', () => {
    expect(roleHasPermission('viewer', 'subscriptions:write')).toBe(false);
  });

  it('denies member team:read', () => {
    expect(roleHasPermission('member', 'team:read')).toBe(false);
  });
});

// ─── formatSubsList ──────────────────────────────────────────────────────────

describe('formatSubsList', () => {
  it('includes each subscription name and monthly cost', () => {
    const subs = [
      makeSub({ name: 'Netflix', price: 15, billing_cycle: 'monthly', currency: 'USD' }),
      makeSub({ id: 'sub-2', name: 'Spotify', price: 9.99, billing_cycle: 'monthly', currency: 'USD' }),
    ];
    const output = formatSubsList(subs);
    expect(output).toContain('Netflix');
    expect(output).toContain('Spotify');
    expect(output).toContain('15.00');
    expect(output).toContain('9.99');
  });

  it('normalises yearly price to monthly equivalent', () => {
    const subs = [makeSub({ name: 'iCloud', price: 120, billing_cycle: 'yearly', currency: 'USD' })];
    expect(formatSubsList(subs)).toContain('10.00');
  });

  it('shows total monthly spend for single currency', () => {
    const subs = [
      makeSub({ price: 10, billing_cycle: 'monthly', currency: 'USD' }),
      makeSub({ id: 'sub-2', price: 20, billing_cycle: 'monthly', currency: 'USD' }),
    ];
    const output = formatSubsList(subs);
    expect(output).toContain('30.00');
    expect(output).toContain('Total');
  });

  it('shows per-currency totals when subscriptions use different currencies', () => {
    const subs = [
      makeSub({ price: 10, billing_cycle: 'monthly', currency: 'USD' }),
      makeSub({ id: 'sub-2', price: 8, billing_cycle: 'monthly', currency: 'EUR' }),
    ];
    const output = formatSubsList(subs);
    expect(output).toContain('USD 10.00');
    expect(output).toContain('EUR 8.00');
  });

  it('includes subscription count in the header', () => {
    const subs = [makeSub(), makeSub({ id: 'sub-2', name: 'Spotify' })];
    expect(formatSubsList(subs)).toContain('(2)');
  });
});

// ─── formatRenewalsList ───────────────────────────────────────────────────────

describe('formatRenewalsList', () => {
  it('shows empty state when no renewals', () => {
    expect(formatRenewalsList([])).toContain('No upcoming renewals');
  });

  it('numbers each renewal starting at 1', () => {
    const renewals = [
      makeRenewal({ name: 'Netflix', daysUntil: 5 }),
      makeRenewal({ subId: 'sub-2', name: 'Spotify', daysUntil: 12 }),
    ];
    const output = formatRenewalsList(renewals);
    expect(output).toContain('*1.*');
    expect(output).toContain('*2.*');
  });

  it('includes the subscription name and price', () => {
    const renewals = [makeRenewal({ name: 'Adobe', price: 54.99, currency: 'USD' })];
    const output = formatRenewalsList(renewals);
    expect(output).toContain('Adobe');
    expect(output).toContain('54.99');
  });

  it('shows "today" when daysUntil is 0', () => {
    const renewals = [makeRenewal({ daysUntil: 0 })];
    expect(formatRenewalsList(renewals)).toContain('today');
  });

  it('shows "tomorrow" when daysUntil is 1', () => {
    const renewals = [makeRenewal({ daysUntil: 1 })];
    expect(formatRenewalsList(renewals)).toContain('tomorrow');
  });

  it('shows days count for daysUntil > 1', () => {
    const renewals = [makeRenewal({ daysUntil: 7 })];
    expect(formatRenewalsList(renewals)).toContain('7d');
  });

  it('includes /snooze hint in the footer', () => {
    const renewals = [makeRenewal()];
    expect(formatRenewalsList(renewals)).toContain('/snooze');
  });
});

// ─── Renewal context store ────────────────────────────────────────────────────

describe('renewal context store', () => {
  afterEach(() => renewalContextStore.clear());

  it('stores and retrieves context by chatId', () => {
    const renewals = [makeRenewal()];
    setRenewalContext('chat-1', renewals);
    expect(getRenewalContext('chat-1')).toEqual(renewals);
  });

  it('returns null for unknown chatId', () => {
    expect(getRenewalContext('unknown')).toBeNull();
  });

  it('overwrites previous context on second call', () => {
    setRenewalContext('chat-1', [makeRenewal({ name: 'A' })]);
    setRenewalContext('chat-1', [makeRenewal({ name: 'B' })]);
    expect(getRenewalContext('chat-1')![0].name).toBe('B');
  });
});

// ─── /renewals command handler ────────────────────────────────────────────────

describe('/renewals command handler', () => {
  let handleRenewalsCommand: typeof import('../src/services/telegram-command-service').handleRenewalsCommand;

  beforeAll(async () => {
    const mod = await import('../src/services/telegram-command-service');
    handleRenewalsCommand = mod.handleRenewalsCommand;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockTrackDbRequest.mockReturnValue(jest.fn());
    mockGetUserRole.mockResolvedValue('member');
    renewalContextStore.clear();
  });

  it('replies with not-linked message when chat has no account', async () => {
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: null, error: null }) }),
      }),
    });
    const reply = jest.fn();
    await handleRenewalsCommand(makeCtx(12345, '/renewals', reply));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('not linked'));
  });

  it('replies with permission denied when role lookup fails', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'user-1' }, error: null }) }) }) };
      }
      return { select: jest.fn() };
    });
    mockGetUserRole.mockRejectedValue(new Error('DB error'));

    const reply = jest.fn();
    await handleRenewalsCommand(makeCtx(12345, '/renewals', reply));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('verify your permissions'));
  });

  it('replies with empty state when no upcoming renewals', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'user-1' }, error: null }) }) }) };
      }
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              not: jest.fn().mockReturnValue({
                gte: jest.fn().mockReturnValue({
                  lte: jest.fn().mockReturnValue({
                    order: jest.fn().mockResolvedValue({ data: [], error: null }),
                  }),
                }),
              }),
            }),
          }),
        }),
      };
    });

    const reply = jest.fn();
    await handleRenewalsCommand(makeCtx(12345, '/renewals', reply));
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining('No upcoming renewals'),
      expect.objectContaining({ parse_mode: 'Markdown' })
    );
  });

  it('replies with formatted list and stores context when renewals exist', async () => {
    const subRow = {
      id: 'sub-1',
      name: 'Netflix',
      price: 15,
      currency: 'USD',
      billing_cycle: 'monthly',
      next_billing_date: '2026-06-10',
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'user-1' }, error: null }) }) }) };
      }
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              not: jest.fn().mockReturnValue({
                gte: jest.fn().mockReturnValue({
                  lte: jest.fn().mockReturnValue({
                    order: jest.fn().mockResolvedValue({ data: [subRow], error: null }),
                  }),
                }),
              }),
            }),
          }),
        }),
      };
    });

    const reply = jest.fn();
    await handleRenewalsCommand(makeCtx(12345, '/renewals', reply));

    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining('Netflix'),
      expect.objectContaining({ parse_mode: 'Markdown' })
    );
    expect(getRenewalContext('12345')).not.toBeNull();
  });

  it('replies with error message when DB query throws', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'user-1' }, error: null }) }) }) };
      }
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              not: jest.fn().mockReturnValue({
                gte: jest.fn().mockReturnValue({
                  lte: jest.fn().mockReturnValue({
                    order: jest.fn().mockResolvedValue({ data: null, error: new Error('DB down') }),
                  }),
                }),
              }),
            }),
          }),
        }),
      };
    });

    const reply = jest.fn();
    await handleRenewalsCommand(makeCtx(12345, '/renewals', reply));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Could not load'));
  });
});

// ─── /snooze command handler ──────────────────────────────────────────────────

describe('/snooze command handler', () => {
  let handleSnoozeCommand: typeof import('../src/services/telegram-command-service').handleSnoozeCommand;

  beforeAll(async () => {
    const mod = await import('../src/services/telegram-command-service');
    handleSnoozeCommand = mod.handleSnoozeCommand;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockTrackDbRequest.mockReturnValue(jest.fn());
    mockGetUserRole.mockResolvedValue('member');
    renewalContextStore.clear();
  });

  it('replies with usage hint when arguments are missing', async () => {
    const reply = jest.fn();
    await handleSnoozeCommand(makeCtx(12345, '/snooze', reply));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Usage'), expect.anything());
  });

  it('replies with usage hint when only one argument is given', async () => {
    const reply = jest.fn();
    await handleSnoozeCommand(makeCtx(12345, '/snooze 1', reply));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Usage'), expect.anything());
  });

  it('replies with invalid-arguments message for non-numeric N', async () => {
    const reply = jest.fn();
    await handleSnoozeCommand(makeCtx(12345, '/snooze abc 3', reply));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Invalid arguments'));
  });

  it('replies with invalid-arguments message when days exceeds 30', async () => {
    const reply = jest.fn();
    await handleSnoozeCommand(makeCtx(12345, '/snooze 1 31', reply));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Invalid arguments'));
  });

  it('replies with invalid-arguments message when days is 0', async () => {
    const reply = jest.fn();
    await handleSnoozeCommand(makeCtx(12345, '/snooze 1 0', reply));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Invalid arguments'));
  });

  it('replies with not-linked message when chat has no account', async () => {
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: null, error: null }) }),
      }),
    });
    const reply = jest.fn();
    await handleSnoozeCommand(makeCtx(12345, '/snooze 1 3', reply));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('not linked'));
  });

  it('denies snooze for viewer role', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'user-1' }, error: null }) }) }) };
      }
      return { select: jest.fn() };
    });
    mockGetUserRole.mockResolvedValue('viewer');

    const reply = jest.fn();
    await handleSnoozeCommand(makeCtx(12345, '/snooze 1 3', reply));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Viewer accounts'));
  });

  it('replies with no-context message when /renewals was not called first', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'user-1' }, error: null }) }) }) };
      }
      return { select: jest.fn() };
    });
    const reply = jest.fn();
    await handleSnoozeCommand(makeCtx(12345, '/snooze 1 3', reply));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('run /renewals first'));
  });

  it('replies with out-of-bounds message when N exceeds list length', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'user-1' }, error: null }) }) }) };
      }
      return { select: jest.fn() };
    });
    setRenewalContext('12345', [makeRenewal()]);

    const reply = jest.fn();
    await handleSnoozeCommand(makeCtx(12345, '/snooze 5 3', reply));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('confirms snooze on success', async () => {
    const mockUpsert = jest.fn().mockResolvedValue({ error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'user-1' }, error: null }) }) }) };
      }
      if (table === 'subscription_notification_preferences') {
        return { upsert: mockUpsert };
      }
      return { select: jest.fn() };
    });
    setRenewalContext('12345', [makeRenewal({ name: 'Netflix' })]);

    const reply = jest.fn();
    await handleSnoozeCommand(makeCtx(12345, '/snooze 1 3', reply));

    expect(mockUpsert).toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining('Netflix'),
      expect.objectContaining({ parse_mode: 'Markdown' })
    );
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('3 day'), expect.anything());
  });

  it('replies with error when DB upsert fails', async () => {
    const mockUpsert = jest.fn().mockResolvedValue({ error: new Error('DB write error') });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'user-1' }, error: null }) }) }) };
      }
      if (table === 'subscription_notification_preferences') {
        return { upsert: mockUpsert };
      }
      return { select: jest.fn() };
    });
    setRenewalContext('12345', [makeRenewal()]);

    const reply = jest.fn();
    await handleSnoozeCommand(makeCtx(12345, '/snooze 1 3', reply));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Could not snooze'));
  });

  it('allows owner to snooze', async () => {
    mockGetUserRole.mockResolvedValue('owner');
    const mockUpsert = jest.fn().mockResolvedValue({ error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'user-1' }, error: null }) }) }) };
      }
      if (table === 'subscription_notification_preferences') {
        return { upsert: mockUpsert };
      }
      return { select: jest.fn() };
    });
    setRenewalContext('12345', [makeRenewal()]);

    const reply = jest.fn();
    await handleSnoozeCommand(makeCtx(12345, '/snooze 1 7', reply));
    expect(mockUpsert).toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('7 day'), expect.anything());
  });
});

// ─── /subs command handler ────────────────────────────────────────────────────

describe('/subs command handler', () => {
  let handleSubsCommand: typeof import('../src/services/telegram-command-service').handleSubsCommand;

  beforeAll(async () => {
    const mod = await import('../src/services/telegram-command-service');
    handleSubsCommand = mod.handleSubsCommand;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockTrackDbRequest.mockReturnValue(jest.fn());
  });

  it('replies with not-linked message when chat_id has no matching user', async () => {
    mockFrom.mockReturnValue({ select: mockSelect });
    mockSelect.mockReturnValue({ eq: mockEqUser });
    mockEqUser.mockReturnValue({ single: mockSingle });
    mockSingle.mockResolvedValue({ data: null, error: null });

    const reply = jest.fn();
    await handleSubsCommand(makeCtx(12345, '', reply));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('not linked'));
  });

  it('replies with empty message when user has no active subscriptions', async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: 'user-1' }, error: null });
    const mockOrderResult = jest.fn().mockResolvedValue({ data: [], error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: mockSingle }) }) };
      return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ order: mockOrderResult }) }) }) };
    });

    const reply = jest.fn();
    await handleSubsCommand(makeCtx(12345, '', reply));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('no active subscriptions'));
  });

  it('replies with error message when DB lookup throws', async () => {
    mockFrom.mockImplementation(() => ({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockRejectedValue(new Error('DB error')),
        }),
      }),
    }));

    const reply = jest.fn();
    await handleSubsCommand(makeCtx(12345, '', reply));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('went wrong'));
  });
});