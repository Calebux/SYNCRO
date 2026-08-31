import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { RenewalEventType, RenewalStatus } from './renewal-history.entity';

// ─── Query DTO ────────────────────────────────────────────────────────────────

export class GetRenewalHistoryQueryDto {
  @ApiPropertyOptional({
    enum: RenewalEventType,
    isArray: true,
    description: 'Filter by one or more event types',
    example: ['renewed', 'failed'],
  })
  @IsOptional()
  @IsEnum(RenewalEventType, { each: true })
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  eventTypes?: RenewalEventType[];

  @ApiPropertyOptional({
    enum: RenewalStatus,
    description: 'Filter by renewal status',
  })
  @IsOptional()
  @IsEnum(RenewalStatus)
  status?: RenewalStatus;

  @ApiPropertyOptional({ default: 1, minimum: 1, description: 'Page number' })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    default: 20,
    minimum: 1,
    maximum: 100,
    description: 'Items per page',
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

// ─── Record DTOs ──────────────────────────────────────────────────────────────

export class RenewalEventDto {
  @ApiProperty({ example: 'a1b2c3d4-...' })
  id: string;

  @ApiProperty({ example: '2025-01-15T10:00:00Z' })
  date: string;

  @ApiProperty({ enum: RenewalEventType, example: RenewalEventType.RENEWED })
  type: RenewalEventType;

  @ApiPropertyOptional({ enum: RenewalStatus, example: RenewalStatus.SUCCESS })
  status?: RenewalStatus;

  @ApiPropertyOptional({ example: 15.99 })
  amount?: number;

  @ApiPropertyOptional({ example: 'USD' })
  currency?: string;

  @ApiPropertyOptional({ example: 'stellar' })
  paymentMethod?: string;

  @ApiPropertyOptional({ example: '0xabc123...' })
  transactionHash?: string;

  @ApiPropertyOptional({ example: 52345678 })
  blockchainLedger?: number;

  @ApiPropertyOptional({ example: true })
  blockchainVerified?: boolean;

  @ApiPropertyOptional({
    example: 'https://stellar.expert/explorer/public/tx/0xabc...',
  })
  explorerUrl?: string;

  @ApiPropertyOptional({ example: 'email' })
  channel?: string;

  @ApiPropertyOptional({ example: 'Payment failed: insufficient balance' })
  notes?: string;
}

export class RenewalHistoryResponseDto {
  @ApiProperty({ example: 'uuid-of-subscription' })
  subscriptionId: string;

  @ApiProperty({ type: [RenewalEventDto] })
  history: RenewalEventDto[];

  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 3 })
  totalPages: number;
}

// ─── Create DTO (internal — used by other services) ───────────────────────────

export class CreateRenewalHistoryDto {
  @IsUUID()
  subscriptionId: string;

  @IsUUID()
  userId: string;

  @IsEnum(RenewalEventType)
  eventType: RenewalEventType;

  @IsOptional()
  @IsEnum(RenewalStatus)
  status?: RenewalStatus;

  @IsOptional()
  amount?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  transactionHash?: string;

  @IsOptional()
  blockchainLedger?: number;

  @IsOptional()
  @IsString()
  channel?: string;

  @IsOptional()
  blockchainVerified?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}
