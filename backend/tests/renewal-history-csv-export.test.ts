/**
 * Renewal History CSV Export Tests
 * 
 * Tests for CSV injection vulnerability fixes in CSV exports.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RenewalHistoryService } from '../src/subscription-renewal-history-timeline/renewal-history.service';
import { RenewalHistory, RenewalEventType } from '../src/subscription-renewal-history-timeline/renewal-history.entity';

describe('RenewalHistoryService - CSV Export Security', () => {
  let service: RenewalHistoryService;
  let repository: Repository<RenewalHistory>;

  const mockRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RenewalHistoryService,
        {
          provide: getRepositoryToken(RenewalHistory),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<RenewalHistoryService>(RenewalHistoryService);
    repository = module.get<Repository<RenewalHistory>>(
      getRepositoryToken(RenewalHistory),
    );

    jest.clearAllMocks();
  });

  describe('Formula Injection Protection', () => {
    it('should sanitize cells starting with =', async () => {
      const mockData: Partial<RenewalHistory>[] = [
        {
          id: '123',
          createdAt: new Date('2025-01-01'),
          eventType: RenewalEventType.PAYMENT_RECEIVED,
          status: 'success',
          amount: '15.99',
          currency: 'USD',
          paymentMethod: 'card',
          transactionHash: null,
          blockchainLedger: null,
          blockchainVerified: false,
          channel: null,
          notes: '=1+1',
        },
      ];

      mockRepository.find.mockResolvedValue(mockData);

      const csv = await service.exportCsv('sub-123', 'user-123');

      expect(csv).toContain("'=1+1");
      expect(csv).not.toMatch(/^=1\+1/m); // Should not start line with formula
    });

    it('should sanitize cells starting with +', async () => {
      const mockData: Partial<RenewalHistory>[] = [
        {
          id: '123',
          createdAt: new Date('2025-01-01'),
          eventType: RenewalEventType.PAYMENT_RECEIVED,
          status: 'success',
          amount: '15.99',
          currency: 'USD',
          paymentMethod: '+1234567890',
          transactionHash: null,
          blockchainLedger: null,
          blockchainVerified: false,
          channel: null,
          notes: null,
        },
      ];

      mockRepository.find.mockResolvedValue(mockData);

      const csv = await service.exportCsv('sub-123', 'user-123');

      expect(csv).toContain("'+1234567890");
    });

    it('should sanitize cells starting with -', async () => {
      const mockData: Partial<RenewalHistory>[] = [
        {
          id: '123',
          createdAt: new Date('2025-01-01'),
          eventType: RenewalEventType.PAYMENT_RECEIVED,
          status: 'success',
          amount: '15.99',
          currency: 'USD',
          paymentMethod: 'card',
          transactionHash: null,
          blockchainLedger: null,
          blockchainVerified: false,
          channel: null,
          notes: '-suspicious command',
        },
      ];

      mockRepository.find.mockResolvedValue(mockData);

      const csv = await service.exportCsv('sub-123', 'user-123');

      expect(csv).toContain("'-suspicious command");
    });

    it('should sanitize cells starting with @', async () => {
      const mockData: Partial<RenewalHistory>[] = [
        {
          id: '123',
          createdAt: new Date('2025-01-01'),
          eventType: RenewalEventType.PAYMENT_RECEIVED,
          status: 'success',
          amount: '15.99',
          currency: 'USD',
          paymentMethod: 'card',
          transactionHash: null,
          blockchainLedger: null,
          blockchainVerified: false,
          channel: null,
          notes: '@SUM(A1:A10)',
        },
      ];

      mockRepository.find.mockResolvedValue(mockData);

      const csv = await service.exportCsv('sub-123', 'user-123');

      expect(csv).toContain("'@SUM(A1:A10)");
    });

    it('should sanitize cells starting with tab', async () => {
      const mockData: Partial<RenewalHistory>[] = [
        {
          id: '123',
          createdAt: new Date('2025-01-01'),
          eventType: RenewalEventType.PAYMENT_RECEIVED,
          status: 'success',
          amount: '15.99',
          currency: 'USD',
          paymentMethod: 'card',
          transactionHash: null,
          blockchainLedger: null,
          blockchainVerified: false,
          channel: null,
          notes: '\ttabbed content',
        },
      ];

      mockRepository.find.mockResolvedValue(mockData);

      const csv = await service.exportCsv('sub-123', 'user-123');

      expect(csv).toContain("'\t");
    });

    it('should sanitize cells starting with carriage return', async () => {
      const mockData: Partial<RenewalHistory>[] = [
        {
          id: '123',
          createdAt: new Date('2025-01-01'),
          eventType: RenewalEventType.PAYMENT_RECEIVED,
          status: 'success',
          amount: '15.99',
          currency: 'USD',
          paymentMethod: 'card',
          transactionHash: null,
          blockchainLedger: null,
          blockchainVerified: false,
          channel: null,
          notes: '\rcarriage return',
        },
      ];

      mockRepository.find.mockResolvedValue(mockData);

      const csv = await service.exportCsv('sub-123', 'user-123');

      expect(csv).toContain("'\r");
    });

    it('should handle complex formula injection attempts', async () => {
      const mockData: Partial<RenewalHistory>[] = [
        {
          id: '123',
          createdAt: new Date('2025-01-01'),
          eventType: RenewalEventType.PAYMENT_RECEIVED,
          status: 'success',
          amount: '15.99',
          currency: 'USD',
          paymentMethod: '=cmd|"/c calc"',
          transactionHash: null,
          blockchainLedger: null,
          blockchainVerified: false,
          channel: null,
          notes: '=HYPERLINK("http://evil.com","Click")',
        },
      ];

      mockRepository.find.mockResolvedValue(mockData);

      const csv = await service.exportCsv('sub-123', 'user-123');

      expect(csv).toContain("'=cmd");
      expect(csv).toContain("'=HYPERLINK");
    });
  });

  describe('CSV Formatting', () => {
    it('should properly escape cells with commas', async () => {
      const mockData: Partial<RenewalHistory>[] = [
        {
          id: '123',
          createdAt: new Date('2025-01-01'),
          eventType: RenewalEventType.PAYMENT_RECEIVED,
          status: 'success',
          amount: '15.99',
          currency: 'USD',
          paymentMethod: 'card',
          transactionHash: null,
          blockchainLedger: null,
          blockchainVerified: false,
          channel: null,
          notes: 'Payment received, thanks',
        },
      ];

      mockRepository.find.mockResolvedValue(mockData);

      const csv = await service.exportCsv('sub-123', 'user-123');

      expect(csv).toContain('"Payment received, thanks"');
    });

    it('should properly escape cells with quotes', async () => {
      const mockData: Partial<RenewalHistory>[] = [
        {
          id: '123',
          createdAt: new Date('2025-01-01'),
          eventType: RenewalEventType.PAYMENT_RECEIVED,
          status: 'success',
          amount: '15.99',
          currency: 'USD',
          paymentMethod: 'card',
          transactionHash: null,
          blockchainLedger: null,
          blockchainVerified: false,
          channel: null,
          notes: 'Payment "confirmed"',
        },
      ];

      mockRepository.find.mockResolvedValue(mockData);

      const csv = await service.exportCsv('sub-123', 'user-123');

      expect(csv).toContain('"Payment ""confirmed"""');
    });

    it('should handle null and undefined values', async () => {
      const mockData: Partial<RenewalHistory>[] = [
        {
          id: '123',
          createdAt: new Date('2025-01-01'),
          eventType: RenewalEventType.PAYMENT_RECEIVED,
          status: null,
          amount: null,
          currency: null,
          paymentMethod: null,
          transactionHash: null,
          blockchainLedger: null,
          blockchainVerified: false,
          channel: null,
          notes: null,
        },
      ];

      mockRepository.find.mockResolvedValue(mockData);

      const csv = await service.exportCsv('sub-123', 'user-123');

      // Should have empty cells but valid CSV structure
      expect(csv).toMatch(/,{2,}/); // Multiple consecutive commas
      expect(csv.split('\n').length).toBeGreaterThan(1); // Header + at least one row
    });

    it('should include correct headers', async () => {
      mockRepository.find.mockResolvedValue([]);

      const csv = await service.exportCsv('sub-123', 'user-123');

      const headers = csv.split('\n')[0];
      expect(headers).toContain('id');
      expect(headers).toContain('date');
      expect(headers).toContain('type');
      expect(headers).toContain('status');
      expect(headers).toContain('amount');
      expect(headers).toContain('currency');
      expect(headers).toContain('paymentMethod');
      expect(headers).toContain('notes');
    });
  });

  describe('Safe Content', () => {
    it('should allow safe content without modification', async () => {
      const mockData: Partial<RenewalHistory>[] = [
        {
          id: '123',
          createdAt: new Date('2025-01-01'),
          eventType: RenewalEventType.PAYMENT_RECEIVED,
          status: 'success',
          amount: '15.99',
          currency: 'USD',
          paymentMethod: 'credit card',
          transactionHash: 'abc123',
          blockchainLedger: 'stellar',
          blockchainVerified: true,
          channel: 'web',
          notes: 'Regular payment processed successfully',
        },
      ];

      mockRepository.find.mockResolvedValue(mockData);

      const csv = await service.exportCsv('sub-123', 'user-123');

      expect(csv).toContain('success');
      expect(csv).toContain('15.99');
      expect(csv).toContain('USD');
      expect(csv).toContain('credit card');
      expect(csv).toContain('Regular payment processed successfully');
    });

    it('should handle formula characters in middle of content', async () => {
      const mockData: Partial<RenewalHistory>[] = [
        {
          id: '123',
          createdAt: new Date('2025-01-01'),
          eventType: RenewalEventType.PAYMENT_RECEIVED,
          status: 'success',
          amount: '15.99',
          currency: 'USD',
          paymentMethod: 'card',
          transactionHash: null,
          blockchainLedger: null,
          blockchainVerified: false,
          channel: null,
          notes: 'Payment of $10 + $5 received',
        },
      ];

      mockRepository.find.mockResolvedValue(mockData);

      const csv = await service.exportCsv('sub-123', 'user-123');

      // Should NOT be escaped since + is not at start
      expect(csv).not.toContain("'Payment of $10 + $5 received");
      expect(csv).toContain('Payment of $10 + $5 received');
    });
  });

  describe('Multiple Rows', () => {
    it('should handle multiple rows with mixed content', async () => {
      const mockData: Partial<RenewalHistory>[] = [
        {
          id: '1',
          createdAt: new Date('2025-01-01'),
          eventType: RenewalEventType.PAYMENT_RECEIVED,
          status: 'success',
          amount: '15.99',
          currency: 'USD',
          paymentMethod: 'card',
          transactionHash: null,
          blockchainLedger: null,
          blockchainVerified: false,
          channel: null,
          notes: 'Normal note',
        },
        {
          id: '2',
          createdAt: new Date('2025-01-02'),
          eventType: RenewalEventType.PAYMENT_FAILED,
          status: 'failed',
          amount: '15.99',
          currency: 'USD',
          paymentMethod: '=EVIL()',
          transactionHash: null,
          blockchainLedger: null,
          blockchainVerified: false,
          channel: null,
          notes: '@DANGEROUS',
        },
        {
          id: '3',
          createdAt: new Date('2025-01-03'),
          eventType: RenewalEventType.RENEWAL_REMINDER,
          status: null,
          amount: null,
          currency: null,
          paymentMethod: null,
          transactionHash: null,
          blockchainLedger: null,
          blockchainVerified: false,
          channel: null,
          notes: null,
        },
      ];

      mockRepository.find.mockResolvedValue(mockData);

      const csv = await service.exportCsv('sub-123', 'user-123');

      const lines = csv.split('\n');
      expect(lines.length).toBe(4); // Header + 3 data rows

      // Check first row is normal
      expect(lines[1]).toContain('Normal note');

      // Check second row has sanitized content
      expect(lines[2]).toContain("'=EVIL()");
      expect(lines[2]).toContain("'@DANGEROUS");

      // Check third row handles nulls
      expect(lines[3]).toMatch(/,{2,}/);
    });
  });
});
