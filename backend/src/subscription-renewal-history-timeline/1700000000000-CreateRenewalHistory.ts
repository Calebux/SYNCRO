import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

export class CreateRenewalHistory1700000000000 implements MigrationInterface {
  name = 'CreateRenewalHistory1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'renewal_history',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          {
            name: 'subscription_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'user_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'event_type',
            type: 'text',
            isNullable: false,
            comment: "One of: 'renewed', 'failed', 'cancelled', 'paused', 'reminder_sent', 'reactivated'",
          },
          {
            name: 'status',
            type: 'text',
            isNullable: true,
            comment: "'success' | 'failed' | 'pending'",
          },
          {
            name: 'amount',
            type: 'decimal',
            precision: 10,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'currency',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'payment_method',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'transaction_hash',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'blockchain_ledger',
            type: 'integer',
            isNullable: true,
          },
          {
            name: 'channel',
            type: 'text',
            isNullable: true,
            comment: "Populated for reminder_sent events — e.g. 'email', 'sms', 'push'",
          },
          {
            name: 'blockchain_verified',
            type: 'boolean',
            default: false,
          },
          {
            name: 'notes',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamptz',
            default: 'NOW()',
          },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'renewal_history',
      new TableForeignKey({
        columnNames: ['subscription_id'],
        referencedTableName: 'subscriptions',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'renewal_history',
      new TableForeignKey({
        columnNames: ['user_id'],
        referencedTableName: 'profiles',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    // Composite index for fast per-subscription timeline queries
    await queryRunner.createIndex(
      'renewal_history',
      new TableIndex({
        name: 'IDX_renewal_history_subscription_created',
        columnNames: ['subscription_id', 'created_at'],
      }),
    );

    // Index for per-user history queries
    await queryRunner.createIndex(
      'renewal_history',
      new TableIndex({
        name: 'IDX_renewal_history_user_created',
        columnNames: ['user_id', 'created_at'],
      }),
    );

    // Index for event_type filtering
    await queryRunner.createIndex(
      'renewal_history',
      new TableIndex({
        name: 'IDX_renewal_history_event_type',
        columnNames: ['event_type'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('renewal_history', true, true, true);
  }
}
