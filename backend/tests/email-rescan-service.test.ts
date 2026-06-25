import { emailRescanService } from '../src/services/email-rescan-service';
import { supabase } from '../src/config/database';
import { auditService } from '../src/services/audit-service';
import { idempotencyService } from '../src/services/idempotency';
import { parseSubscriptionEmailWithFallback } from '../src/services/email-parser';

jest.mock('../src/config/database', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

jest.mock('../src/services/audit-service', () => ({
  auditService: {
    insertEntry: jest.fn().mockResolvedValue({ success: true }),
  },
}));

jest.mock('../src/services/idempotency', () => ({
  idempotencyService: {
    findPotentialDuplicates: jest.fn(),
  },
}));

jest.mock('../src/services/email-parser', () => ({
  parseSubscriptionEmailWithFallback: jest.fn(),
}));

jest.mock('../src/config/logger');

describe('EmailRescanService', () => {
  const mockUserId = 'user-123';
  const mockEmailAccountId = '9ca3df96-d4a5-4f31-b79f-79892ec8fd36';
  const mockJobId = 'job-123';

  const rescanJobsTable = {
    insert: jest.fn(),
    update: jest.fn(),
    select: jest.fn(),
    single: jest.fn(),
    eq: jest.fn(),
  };

  const subscriptionsTable = {
    insert: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    rescanJobsTable.insert.mockReturnValue(rescanJobsTable);
    rescanJobsTable.select.mockReturnValue(rescanJobsTable);
    rescanJobsTable.single.mockResolvedValue({ data: { id: mockJobId }, error: null });
    rescanJobsTable.update.mockReturnValue(rescanJobsTable);
    rescanJobsTable.eq.mockResolvedValue({ error: null });

    subscriptionsTable.insert.mockResolvedValue({ error: null });

    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'rescan_jobs') {
        return rescanJobsTable;
      }

      if (table === 'subscriptions') {
        return subscriptionsTable;
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    (idempotencyService.findPotentialDuplicates as jest.Mock).mockResolvedValue({
      duplicates: [],
      message: null,
    });
  });

  it('completes a bounded rescan and records audit events', async () => {
    jest.spyOn(emailRescanService as any, 'fetchEmails').mockResolvedValue([
      { id: 'email-1', from: 'billing@netflix.com', subject: 'Netflix receipt', bodyText: 'Netflix $15.99 monthly', date: '2026-05-01T10:00:00Z' },
      { id: 'email-2', from: 'hello@example.com', subject: 'Hello', bodyText: 'Nothing billable here', date: '2026-05-01T11:00:00Z' },
    ]);

    (parseSubscriptionEmailWithFallback as jest.Mock)
      .mockResolvedValueOnce({ name: 'Netflix', amount: 15.99, currency: 'USD', interval: 'monthly', confidence: 0.95 })
      .mockResolvedValueOnce(null);

    const result = await emailRescanService.triggerRescan({
      userId: mockUserId,
      operatorId: mockUserId,
      emailAccountId: mockEmailAccountId,
      startDate: '2026-05-01T00:00:00Z',
      endDate: '2026-05-15T23:59:59Z',
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
    });

    expect(result).toEqual({
      jobId: mockJobId,
      status: 'completed',
      processedCount: 2,
      subscriptionsCreated: 1,
      duplicatesSkipped: 0,
    });
    expect(subscriptionsTable.insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: mockUserId,
      email_account_id: mockEmailAccountId,
      name: 'Netflix',
      source: 'email_rescan',
    }));
    expect(auditService.insertEntry).toHaveBeenNthCalledWith(1, expect.objectContaining({
      action: 'email_rescan_requested',
      resourceType: 'rescan_job',
      resourceId: mockJobId,
    }));
    expect(auditService.insertEntry).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: 'email_rescan_completed',
      resourceType: 'rescan_job',
      resourceId: mockJobId,
      metadata: expect.objectContaining({
        processedCount: 2,
        subscriptionsCreated: 1,
        duplicatesSkipped: 0,
      }),
    }));
  });

  it('skips duplicate subscriptions during replay', async () => {
    jest.spyOn(emailRescanService as any, 'fetchEmails').mockResolvedValue([
      { id: 'email-1', from: 'billing@hulu.com', subject: 'Hulu receipt', bodyText: 'Hulu $10.99 monthly', date: '2026-05-01T10:00:00Z' },
    ]);

    (parseSubscriptionEmailWithFallback as jest.Mock).mockResolvedValue({
      name: 'Hulu',
      amount: 10.99,
      currency: 'USD',
      interval: 'monthly',
      confidence: 0.92,
    });

    (idempotencyService.findPotentialDuplicates as jest.Mock).mockResolvedValue({
      duplicates: [{ id: 'sub-existing' }],
      message: 'duplicate',
    });

    const result = await emailRescanService.triggerRescan({
      userId: mockUserId,
      emailAccountId: mockEmailAccountId,
      startDate: '2026-05-01T00:00:00Z',
      endDate: '2026-05-02T00:00:00Z',
    });

    expect(result.status).toBe('completed');
    expect(result.subscriptionsCreated).toBe(0);
    expect(result.duplicatesSkipped).toBe(1);
    expect(subscriptionsTable.insert).not.toHaveBeenCalled();
  });

  it('marks the job as failed and audits the error when the provider fetch fails', async () => {
    jest.spyOn(emailRescanService as any, 'fetchEmails').mockRejectedValue(new Error('Provider failed'));

    const result = await emailRescanService.triggerRescan({
      userId: mockUserId,
      emailAccountId: mockEmailAccountId,
      startDate: '2026-05-01T00:00:00Z',
      endDate: '2026-05-02T00:00:00Z',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toBe('Provider failed');
    expect(auditService.insertEntry).toHaveBeenLastCalledWith(expect.objectContaining({
      action: 'email_rescan_failed',
      resourceType: 'rescan_job',
      resourceId: mockJobId,
    }));
  });

  it('rejects replay windows longer than the configured maximum', async () => {
    await expect(
      emailRescanService.triggerRescan({
        userId: mockUserId,
        emailAccountId: mockEmailAccountId,
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-02-15T00:00:00Z',
      }),
    ).rejects.toThrow('Re-scan window cannot exceed 31 days');

    expect(supabase.from).not.toHaveBeenCalled();
  });
});
