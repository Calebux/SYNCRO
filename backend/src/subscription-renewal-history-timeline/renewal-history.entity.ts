import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum RenewalEventType {
  RENEWED = 'renewed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  PAUSED = 'paused',
  REACTIVATED = 'reactivated',
  REMINDER_SENT = 'reminder_sent',
}

export enum RenewalStatus {
  SUCCESS = 'success',
  FAILED = 'failed',
  PENDING = 'pending',
}

export enum RenewalChannel {
  EMAIL = 'email',
  SMS = 'sms',
  PUSH = 'push',
}

@Entity('renewal_history')
@Index('IDX_renewal_history_subscription_created', ['subscriptionId', 'createdAt'])
@Index('IDX_renewal_history_user_created', ['userId', 'createdAt'])
export class RenewalHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'subscription_id', type: 'uuid' })
  @Index()
  subscriptionId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({
    name: 'event_type',
    type: 'text',
    enum: RenewalEventType,
  })
  eventType: RenewalEventType;

  @Column({ type: 'text', nullable: true, enum: RenewalStatus })
  status: RenewalStatus | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  amount: number | null;

  @Column({ type: 'text', nullable: true })
  currency: string | null;

  @Column({ name: 'payment_method', type: 'text', nullable: true })
  paymentMethod: string | null;

  @Column({ name: 'transaction_hash', type: 'text', nullable: true })
  transactionHash: string | null;

  @Column({ name: 'blockchain_ledger', type: 'integer', nullable: true })
  blockchainLedger: number | null;

  @Column({ type: 'text', nullable: true, enum: RenewalChannel })
  channel: RenewalChannel | null;

  @Column({ name: 'blockchain_verified', type: 'boolean', default: false })
  blockchainVerified: boolean;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
