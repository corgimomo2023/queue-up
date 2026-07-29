import { TableColumn, type MigrationInterface, type QueryRunner } from 'typeorm';

export class InitialSchema1785360000000 implements MigrationInterface {
  readonly name = 'InitialSchema1785360000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS queues (
        id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        email_hash TEXT, phone_hash TEXT, password_hash TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        start_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, end_at TEXT, removed_at TEXT,
        description TEXT, logo_path TEXT
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY,
        queue_id INTEGER NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
        name TEXT NOT NULL, phone TEXT, message TEXT,
        joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        status TEXT NOT NULL DEFAULT 'waiting', token_hash TEXT NOT NULL UNIQUE,
        ended_at TEXT, ended_reason TEXT
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY,
        queue_id INTEGER REFERENCES queues(id) ON DELETE SET NULL,
        customer_id INTEGER, actor_type TEXT NOT NULL, action TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}', ip_address TEXT, user_agent TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.addLegacyColumn(queryRunner, 'queues', 'start_at', {
      type: 'text',
      isNullable: true,
    });
    await this.addLegacyColumn(queryRunner, 'queues', 'end_at', { type: 'text', isNullable: true });
    await this.addLegacyColumn(queryRunner, 'queues', 'removed_at', {
      type: 'text',
      isNullable: true,
    });
    await this.addLegacyColumn(queryRunner, 'queues', 'password_hash', {
      type: 'text',
      isNullable: true,
    });
    await this.addLegacyColumn(queryRunner, 'queues', 'description', {
      type: 'text',
      isNullable: true,
    });
    await this.addLegacyColumn(queryRunner, 'queues', 'logo_path', {
      type: 'text',
      isNullable: true,
    });
    await this.addLegacyColumn(queryRunner, 'customers', 'ended_at', {
      type: 'text',
      isNullable: true,
    });
    await this.addLegacyColumn(queryRunner, 'customers', 'ended_reason', {
      type: 'text',
      isNullable: true,
    });

    await queryRunner.query('UPDATE queues SET start_at=created_at WHERE start_at IS NULL');
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_customers_queue_status ON customers(queue_id, status, id)',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_audit_logs_queue_created ON audit_logs(queue_id, created_at DESC, id DESC)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS audit_logs');
    await queryRunner.query('DROP TABLE IF EXISTS customers');
    await queryRunner.query('DROP TABLE IF EXISTS queues');
  }

  private async addLegacyColumn(
    queryRunner: QueryRunner,
    table: 'queues' | 'customers',
    name: string,
    options: Pick<TableColumn, 'type' | 'isNullable'>,
  ): Promise<void> {
    if (!(await queryRunner.hasColumn(table, name))) {
      await queryRunner.addColumn(table, new TableColumn({ name, ...options }));
    }
  }
}
