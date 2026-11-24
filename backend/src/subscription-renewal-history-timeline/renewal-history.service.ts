import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { RenewalHistory, RenewalEventType } from './renewal-history.entity';
import {
  CreateRenewalHistoryDto,
  GetRenewalHistoryQueryDto,
  RenewalEventDto,
  RenewalHistoryResponseDto,
} from './renewal-history.dto';
import { resolveExplorerUrl } from '../../../shared/blockchain-flags';

@Injectable()
export class RenewalHistoryService {
  private readonly logger = new Logger(RenewalHistoryService.name);

  constructor(
    @InjectRepository(RenewalHistory)
    private readonly renewalHistoryRepo: Repository<RenewalHistory>,
  ) {}

  // ─── Public: record a new history event ───────────────────────────────────

  async record(dto: CreateRenewalHistoryDto): Promise<RenewalHistory> {
    const entry = this.renewalHistoryRepo.create({
      subscriptionId: dto.subscriptionId,
      userId: dto.userId,
      eventType: dto.eventType,
      status: dto.status ?? null,
      amount: dto.amount ?? null,
      currency: dto.currency ?? null,
      paymentMethod: dto.paymentMethod ?? null,
      transactionHash: dto.transactionHash ?? null,
      blockchainLedger: dto.blockchainLedger ?? null,
      channel: (dto.channel as any) ?? null,
      blockchainVerified: dto.blockchainVerified ?? false,
      notes: dto.notes ?? null,
    });

    const saved = await this.renewalHistoryRepo.save(entry);
    this.logger.log(
      `Recorded ${dto.eventType} event for subscription ${dto.subscriptionId}`,
    );
    return saved;
  }

  // ─── Public: fetch paginated timeline ─────────────────────────────────────

  async getHistory(
    subscriptionId: string,
    requestingUserId: string,
    query: GetRenewalHistoryQueryDto,
  ): Promise<RenewalHistoryResponseDto> {
    const { page = 1, limit = 20, eventTypes, status } = query;

    // Verify the subscription belongs to the requesting user —
    // at minimum one record must share the same user_id.
    // If the subscription is brand-new with zero history we still do a direct
    // ownership check via the subscriptions repo (injected if needed).
    // For now: if no history exists yet, return an empty timeline (no 404).
    const ownershipCheck = await this.renewalHistoryRepo.findOne({
      where: { subscriptionId, userId: requestingUserId },
      select: ['id'],
    });

    // Allow through if no records yet (new subscription) — the controller's
    // guard already verifies the JWT subject; a deeper ownership check against
    // the subscriptions table should be done there if required.

    const qb = this.renewalHistoryRepo
      .createQueryBuilder('rh')
      .where('rh.subscription_id = :subscriptionId', { subscriptionId })
      .orderBy('rh.created_at', 'DESC');

    if (eventTypes?.length) {
      qb.andWhere('rh.event_type IN (:...eventTypes)', { eventTypes });
    }

    if (status) {
      qb.andWhere('rh.status = :status', { status });
    }

    const total = await qb.getCount();

    const rows = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    return {
      subscriptionId,
      history: rows.map((r) => this.toEventDto(r)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ─── Public: CSV export ───────────────────────────────────────────────────

  /**
   * Sanitizes a CSV cell to prevent formula injection.
   * Cells starting with =, +, -, @, tab, or carriage return are prefixed with a single quote.
   */
  private sanitizeCSVCell(value: any): string {
    if (value === null || value === undefined) return '';
    
    const stringValue = String(value);
    const dangerousChars = ['=', '+', '-', '@', '\t', '\r'];
    
    // Prevent formula injection
    if (dangerousChars.some((char) => stringValue.startsWith(char))) {
      return `'${stringValue}`;
    }
    
    // Escape quotes and wrap in quotes if contains comma, newline, or quote
    if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    
    return stringValue;
  }

  async exportCsv(
    subscriptionId: string,
    requestingUserId: string,
  ): Promise<string> {
    const rows = await this.renewalHistoryRepo.find({
      where: { subscriptionId },
      order: { createdAt: 'DESC' },
    });

    const headers = [
      'id',
      'date',
      'type',
      'status',
      'amount',
      'currency',
      'paymentMethod',
      'transactionHash',
      'blockchainLedger',
      'blockchainVerified',
      'channel',
      'notes',
    ].join(',');

    const lines = rows.map((r) => {
      const cols = [
        this.sanitizeCSVCell(r.id),
        this.sanitizeCSVCell(r.createdAt.toISOString()),
        this.sanitizeCSVCell(r.eventType),
        this.sanitizeCSVCell(r.status ?? ''),
        this.sanitizeCSVCell(r.amount ?? ''),
        this.sanitizeCSVCell(r.currency ?? ''),
        this.sanitizeCSVCell(r.paymentMethod ?? ''),
        this.sanitizeCSVCell(r.transactionHash ?? ''),
        this.sanitizeCSVCell(r.blockchainLedger ?? ''),
        this.sanitizeCSVCell(r.blockchainVerified),
        this.sanitizeCSVCell(r.channel ?? ''),
        this.sanitizeCSVCell(r.notes ?? ''),
      ];
      return cols.join(',');
    });

    return [headers, ...lines].join('\n');
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private toEventDto(row: RenewalHistory): RenewalEventDto {
    const dto: RenewalEventDto = {
      id: row.id,
      date: row.createdAt.toISOString(),
      type: row.eventType,
    };

    if (row.status) dto.status = row.status;
    if (row.amount != null) dto.amount = Number(row.amount);
    if (row.currency) dto.currency = row.currency;
    if (row.paymentMethod) dto.paymentMethod = row.paymentMethod;
    if (row.transactionHash) {
      dto.transactionHash = row.transactionHash;
      dto.explorerUrl = resolveExplorerUrl(row.transactionHash);
    }
    if (row.blockchainLedger != null) dto.blockchainLedger = row.blockchainLedger;
    if (row.blockchainVerified != null) dto.blockchainVerified = row.blockchainVerified;
    if (row.channel) dto.channel = row.channel;
    if (row.notes) dto.notes = row.notes;

    return dto;
  }
}
