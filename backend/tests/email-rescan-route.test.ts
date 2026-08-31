import express from 'express';
import request from 'supertest';
import emailRescanRouter from '../src/routes/email-rescan';
import { supabase } from '../src/config/database';
import { emailRescanService } from '../src/services/email-rescan-service';
import { errorHandler } from '../src/middleware/errorHandler';

jest.mock('../src/config/database', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

jest.mock('../src/services/email-rescan-service', () => ({
  emailRescanService: {
    triggerRescan: jest.fn(),
  },
}));

jest.mock('../src/config/logger');

describe('Email Rescan Route', () => {
  const app = express();
  const emailAccountsTable = {
    select: jest.fn(),
    eq: jest.fn(),
    single: jest.fn(),
  };

  beforeAll(() => {
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).user = { id: 'user-123', role: 'viewer' };
      next();
    });
    app.use('/api/integrations/email', emailRescanRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    emailAccountsTable.select.mockReturnValue(emailAccountsTable);
    emailAccountsTable.eq.mockReturnValue(emailAccountsTable);
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'email_accounts') {
        return emailAccountsTable;
      }

      throw new Error(`Unexpected table: ${table}`);
    });
  });

  it('returns 404 when the email account is not owned by the caller', async () => {
    emailAccountsTable.single.mockResolvedValue({ data: null, error: { message: 'not found' } });

    const response = await request(app)
      .post('/api/integrations/email/rescan')
      .send({
        emailAccountId: '9ca3df96-d4a5-4f31-b79f-79892ec8fd36',
        startDate: '2026-05-01T00:00:00Z',
        endDate: '2026-05-15T00:00:00Z',
      });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Email account not found');
  });

  it('returns 409 when the account is disconnected', async () => {
    emailAccountsTable.single.mockResolvedValue({
      data: { id: '9ca3df96-d4a5-4f31-b79f-79892ec8fd36', is_connected: false },
      error: null,
    });

    const response = await request(app)
      .post('/api/integrations/email/rescan')
      .send({
        emailAccountId: '9ca3df96-d4a5-4f31-b79f-79892ec8fd36',
        startDate: '2026-05-01T00:00:00Z',
        endDate: '2026-05-15T00:00:00Z',
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('Email account is disconnected');
  });

  it('triggers a bounded replay for a connected account', async () => {
    emailAccountsTable.single.mockResolvedValue({
      data: { id: '9ca3df96-d4a5-4f31-b79f-79892ec8fd36', is_connected: true },
      error: null,
    });

    (emailRescanService.triggerRescan as jest.Mock).mockResolvedValue({
      jobId: 'job-123',
      status: 'completed',
      processedCount: 4,
      subscriptionsCreated: 2,
      duplicatesSkipped: 1,
    });

    const response = await request(app)
      .post('/api/integrations/email/rescan')
      .set('user-agent', 'supertest')
      .send({
        emailAccountId: '9ca3df96-d4a5-4f31-b79f-79892ec8fd36',
        startDate: '2026-05-01T00:00:00Z',
        endDate: '2026-05-15T00:00:00Z',
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.jobId).toBe('job-123');
    expect(emailRescanService.triggerRescan).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-123',
      operatorId: 'user-123',
      emailAccountId: '9ca3df96-d4a5-4f31-b79f-79892ec8fd36',
      ipAddress: expect.any(String),
      userAgent: 'supertest',
    }));
  });

  it('rejects unbounded ranges at validation time', async () => {
    const response = await request(app)
      .post('/api/integrations/email/rescan')
      .send({
        emailAccountId: '9ca3df96-d4a5-4f31-b79f-79892ec8fd36',
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-03-15T00:00:00Z',
      });

    expect(response.status).toBe(400);
    expect(emailRescanService.triggerRescan).not.toHaveBeenCalled();
  });
});
