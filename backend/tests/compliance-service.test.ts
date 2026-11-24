import { ComplianceService } from '../src/services/compliance-service';

// Set test secret before importing
process.env.UNSUBSCRIBE_SECRET = 'test-secret-key-for-hmac-signing';

jest.mock('../src/config/database', () => ({
  supabase: {
    from: jest.fn(),
    auth: {
      admin: {
        deleteUser: jest.fn(),
        getUserById: jest.fn().mockResolvedValue({ data: { user: null } }),
      },
    },
  },
}));

jest.mock('../src/config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock('../src/services/gdpr-deletion-pipeline', () => ({
  executeGdprDeletionPipeline: jest.fn().mockResolvedValue({ success: true, stepsCompleted: ['cascade_delete'] }),
}));

jest.mock('../src/services/email-service', () => ({
  emailService: { sendSimpleEmail: jest.fn().mockResolvedValue(undefined) },
}));

import { supabase } from '../src/config/database';
import { executeGdprDeletionPipeline } from '../src/services/gdpr-deletion-pipeline';

describe('ComplianceService', () => {
  let service: ComplianceService;

  beforeEach(() => {
    service = new ComplianceService();
  });

  describe('HMAC Unsubscribe Tokens', () => {
    it('should generate a valid token', () => {
      const token = service.generateUnsubscribeToken('user-123', 'reminders');
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
    });

    it('should verify a valid token', () => {
      const token = service.generateUnsubscribeToken('user-123', 'reminders');
      const result = service.verifyUnsubscribeToken(token);
      expect(result).toEqual({
        valid: true,
        userId: 'user-123',
        emailType: 'reminders',
      });
    });

    it('should reject a tampered token', () => {
      const token = service.generateUnsubscribeToken('user-123', 'reminders');
      const tampered = token.slice(0, -5) + 'XXXXX';
      const result = service.verifyUnsubscribeToken(tampered);
      expect(result).toEqual({ valid: false });
    });

    it('should reject an expired token', () => {
      const token = service.generateUnsubscribeToken('user-123', 'reminders', Date.now() - 91 * 24 * 60 * 60 * 1000);
      const result = service.verifyUnsubscribeToken(token);
      expect(result).toEqual({ valid: false });
    });

    it('should accept a token within 90-day expiry', () => {
      const token = service.generateUnsubscribeToken('user-123', 'reminders', Date.now() - 89 * 24 * 60 * 60 * 1000);
      const result = service.verifyUnsubscribeToken(token);
      expect(result).toEqual({
        valid: true,
        userId: 'user-123',
        emailType: 'reminders',
      });
    });

    it('should reject a malformed token', () => {
      const result = service.verifyUnsubscribeToken('not-a-real-token');
      expect(result).toEqual({ valid: false });
    });
  });

  describe('gatherUserData', () => {
    function makeQueryBuilder(data: any) {
      const builder: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data, error: null }),
        then: undefined,
      };
      // Make the builder itself a thenable so Promise.all resolves it directly
      // when .single() is not called (array results)
      builder[Symbol.iterator] = undefined;
      return builder;
    }

    function makeArrayQueryBuilder(data: any) {
      const builder: any = {};
      builder.select = jest.fn().mockReturnThis();
      builder.eq = jest.fn().mockReturnThis();
      // resolves as a promise (no .single())
      Object.assign(builder, Promise.resolve({ data, error: null }));
      builder.then = (resolve: any, reject: any) =>
        Promise.resolve({ data, error: null }).then(resolve, reject);
      return builder;
    }

    beforeEach(() => {
      const mockFrom = supabase.from as jest.Mock;
      mockFrom.mockImplementation((table: string) => {
        const singleTables = ['profiles', 'user_preferences'];
        if (singleTables.includes(table)) {
          return makeQueryBuilder({ id: 'user-123', table });
        }
        return makeArrayQueryBuilder([{ id: 'row-1', table }]);
      });
    });

    it('should query all required tables', async () => {
      await service.gatherUserData('user-123');
      const calledTables = (supabase.from as jest.Mock).mock.calls.map((c: any) => c[0]);
      expect(calledTables).toEqual(
        expect.arrayContaining([
          'profiles',
          'subscriptions',
          'notifications',
          'audit_logs',
          'user_preferences',
          'email_accounts',
          'team_members',
          'contract_events',
          'renewal_approvals',
        ])
      );
    });

    it('should return structured export data', async () => {
      const result = await service.gatherUserData('user-123');
      expect(result).toHaveProperty('profile');
      expect(result).toHaveProperty('subscriptions');
      expect(result).toHaveProperty('notifications');
      expect(result).toHaveProperty('auditLogs');
      expect(result).toHaveProperty('preferences');
      expect(result).toHaveProperty('emailAccounts');
      expect(result).toHaveProperty('teams');
      expect(result).toHaveProperty('blockchainLogs');
      expect(result.blockchainLogs).toHaveProperty('contractEvents');
      expect(result.blockchainLogs).toHaveProperty('renewalApprovals');
    });

    it('should fall back to empty values when queries return null', async () => {
      (supabase.from as jest.Mock).mockImplementation(() => {
        const builder: any = {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: null, error: null }),
          then: (resolve: any, reject: any) =>
            Promise.resolve({ data: null, error: null }).then(resolve, reject),
        };
        return builder;
      });
      const result = await service.gatherUserData('user-123');
      expect(result.profile).toEqual({});
      expect(result.subscriptions).toEqual([]);
      expect(result.blockchainLogs.contractEvents).toEqual([]);
    });
  });

  describe('requestDeletion', () => {
    function makeChain(overrides: Record<string, any> = {}) {
      const chain: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        insert: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: { message: 'no rows' } }),
        ...overrides,
      };
      return chain;
    }

    it('should create a new deletion record when none exists', async () => {
      const deletionRecord = { id: 'del-1', user_id: 'user-123', status: 'pending' };
      const mockFrom = supabase.from as jest.Mock;

      // Reuse the same builder so mockResolvedValueOnce calls accumulate on one object
      const deletionsBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        insert: jest.fn().mockReturnThis(),
        single: jest.fn()
          .mockResolvedValueOnce({ data: null, error: { message: 'no rows' } })
          .mockResolvedValueOnce({ data: null, error: { message: 'no rows' } })
          .mockResolvedValueOnce({ data: deletionRecord, error: null }),
      };

      mockFrom.mockImplementation((table: string) => {
        if (table === 'account_deletions') return deletionsBuilder;
        return makeChain({ single: jest.fn().mockResolvedValue({ data: {}, error: null }) });
      });

      const result = await service.requestDeletion('user-123', 'closing account');
      expect(result).toEqual(deletionRecord);
    });

    it('should throw if deletion already pending', async () => {
      const mockFrom = supabase.from as jest.Mock;
      mockFrom.mockImplementation((table: string) => {
        if (table === 'account_deletions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            in: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: { id: 'del-1', status: 'pending' },
              error: null,
            }),
          };
        }
        return makeChain();
      });

      await expect(service.requestDeletion('user-123')).rejects.toThrow(
        'Account deletion already pending'
      );
    });

    it('should cancel active subscriptions when deletion is requested', async () => {
      const deletionRecord = { id: 'del-1', user_id: 'user-123', status: 'pending' };
      const subscriptionsUpdate = jest.fn().mockReturnThis();
      const subscriptionsIn = jest.fn().mockResolvedValue({ data: [], error: null });

      const mockFrom = supabase.from as jest.Mock;

      const deletionsBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        insert: jest.fn().mockReturnThis(),
        single: jest.fn()
          .mockResolvedValueOnce({ data: null, error: { message: 'no rows' } })
          .mockResolvedValueOnce({ data: null, error: { message: 'no rows' } })
          .mockResolvedValueOnce({ data: deletionRecord, error: null }),
      };

      mockFrom.mockImplementation((table: string) => {
        if (table === 'account_deletions') return deletionsBuilder;
        if (table === 'subscriptions') {
          return {
            update: subscriptionsUpdate,
            eq: jest.fn().mockReturnThis(),
            in: subscriptionsIn,
          };
        }
        return makeChain({ single: jest.fn().mockResolvedValue({ data: {}, error: null }) });
      });

      await service.requestDeletion('user-123');
      expect(subscriptionsUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'cancelled' })
      );
    });

    it('should reuse cancelled row when one exists', async () => {
      const cancelledRow = { id: 'del-old' };
      const updatedRecord = { id: 'del-old', user_id: 'user-123', status: 'pending' };
      const mockFrom = supabase.from as jest.Mock;

      const deletionsBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        insert: jest.fn().mockReturnThis(),
        single: jest.fn()
          .mockResolvedValueOnce({ data: null, error: { message: 'no rows' } })
          .mockResolvedValueOnce({ data: cancelledRow, error: null })
          .mockResolvedValueOnce({ data: updatedRecord, error: null }),
      };

      mockFrom.mockImplementation((table: string) => {
        if (table === 'account_deletions') return deletionsBuilder;
        return makeChain({ single: jest.fn().mockResolvedValue({ data: {}, error: null }) });
      });

      const result = await service.requestDeletion('user-123');
      expect(result).toEqual(updatedRecord);
    });
  });

  describe('cancelDeletion', () => {
    it('should update status to cancelled and log audit event', async () => {
      const cancelledRecord = { id: 'del-1', user_id: 'user-123', status: 'cancelled' };
      const mockFrom = supabase.from as jest.Mock;

      mockFrom.mockImplementation((table: string) => {
        if (table === 'account_deletions') {
          return {
            update: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            select: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({ data: cancelledRecord, error: null }),
          };
        }
        // audit_logs insert
        return {
          insert: jest.fn().mockResolvedValue({ data: {}, error: null }),
        };
      });

      const result = await service.cancelDeletion('user-123');
      expect(result).toEqual(cancelledRecord);
    });

    it('should throw if no pending deletion found', async () => {
      (supabase.from as jest.Mock).mockImplementation(() => ({
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: { message: 'no rows' } }),
      }));

      await expect(service.cancelDeletion('user-123')).rejects.toThrow(
        'Failed to cancel deletion'
      );
    });
  });

  describe('getDeletionStatus', () => {
    it('should return pending deletion record if it exists', async () => {
      const record = { id: 'del-1', user_id: 'user-123', status: 'pending' };
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: record, error: null }),
      });

      const result = await service.getDeletionStatus('user-123');
      expect(result).toEqual(record);
    });

    it('should return null if no pending deletion', async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
      });

      const result = await service.getDeletionStatus('user-123');
      expect(result).toBeNull();
    });
  });

  describe('processHardDeletes', () => {
    it('should return 0 when no pending deletions are due', async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        lte: jest.fn().mockResolvedValue({ data: [], error: null }),
      });

      const count = await service.processHardDeletes();
      expect(count).toBe(0);
    });

    it('should run GDPR pipeline then anonymize audit logs before deleting the auth user', async () => {
      const pendingDeletion = { id: 'del-1', user_id: 'user-abc' };
      const callOrder: string[] = [];

      (executeGdprDeletionPipeline as jest.Mock).mockImplementation(async () => {
        callOrder.push('pipeline');
        return { success: true, stepsCompleted: ['cascade_delete'] };
      });

      (supabase.auth.admin.deleteUser as jest.Mock).mockImplementation(() => {
        callOrder.push('deleteUser');
        return Promise.resolve({ error: null });
      });

      (supabase.auth.admin.getUserById as jest.Mock) = jest.fn().mockResolvedValue({
        data: { user: { email: 'test@example.com' } },
      });

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'account_deletions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            lte: jest.fn().mockResolvedValue({ data: [pendingDeletion], error: null }),
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ data: {}, error: null }),
            }),
          };
        }
        return {
          update: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ data: {}, error: null }),
          }),
        };
      });

      const count = await service.processHardDeletes();
      expect(count).toBe(1);
      expect(callOrder[0]).toBe('pipeline');
      expect(callOrder[1]).toBe('deleteUser');
    });

    it('should skip a user and continue if deleteUser fails', async () => {
      const deletions = [
        { id: 'del-1', user_id: 'user-fail' },
        { id: 'del-2', user_id: 'user-ok' },
      ];

      (supabase.auth.admin.deleteUser as jest.Mock)
        .mockResolvedValueOnce({ error: { message: 'auth error' } })
        .mockResolvedValueOnce({ error: null });

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'account_deletions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            lte: jest.fn().mockResolvedValue({ data: deletions, error: null }),
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ data: {}, error: null }),
            }),
          };
        }
        return {
          update: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ data: {}, error: null }),
          }),
        };
      });

      const count = await service.processHardDeletes();
      expect(count).toBe(1);
    });
  });
});
