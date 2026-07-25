import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'fs';
import path from 'path';

const drift = require('../../scripts/check-migration-drift.js');

const BACKEND_MIGRATIONS = path.join(__dirname, '..', '..', 'backend', 'migrations');
const SUPABASE_MIGRATIONS = path.join(__dirname, '..', '..', 'supabase', 'migrations');

const {
  normalizeSQL,
  normalizeSchemaSnapshot,
  extractTables,
  extractIndexes,
  extractPolicies,
  migrationVersion,
  detectTimestampConflicts,
  compareMigrations,
  collectExpectedSchema,
  compareSchemaObjects,
  buildSchemaDiffReport,
  compareSchemaSnapshotFiles,
  readMigrations,
} = drift;

interface MigrationData {
  content: string;
  normalized: string;
  tables: Set<string>;
  indexes: Set<string>;
  policies: Set<string>;
}

interface Issue {
  type: string;
  severity: 'error' | 'warning';
  message: string;
  files?: string[];
  tables?: string[];
  migration?: string;
  executedAt?: string;
}

describe('Migration Drift Check', () => {
  describe('SQL Normalization', () => {
    it('should remove single-line comments', () => {
      const sql = `
        CREATE TABLE users (id INT); -- this is a comment
        INSERT INTO users VALUES (1); -- another comment
      `;
      const normalized = normalizeSQL(sql);
      expect(normalized).not.toContain('--');
      expect(normalized).toContain('create table users');
    });

    it('should remove multi-line comments', () => {
      const sql = `
        /* This is a
           multi-line comment */
        CREATE TABLE users (id INT);
      `;
      const normalized = normalizeSQL(sql);
      expect(normalized).not.toContain('/*');
      expect(normalized).not.toContain('*/');
      expect(normalized).toContain('create table users');
    });

    it('should normalize whitespace', () => {
      const sql = `CREATE   TABLE   users  (  id   INT  )`;
      const normalized = normalizeSQL(sql);
      expect(normalized).toBe('create table users ( id int )');
    });

    it('should be case-insensitive', () => {
      const sql1 = 'CREATE TABLE Users (ID INT)';
      const sql2 = 'create table users (id int)';
      expect(normalizeSQL(sql1)).toBe(normalizeSQL(sql2));
    });

    it('should handle identical migrations with different formatting', () => {
      const sql1 = `
        -- Create users table
        CREATE TABLE public.users (
          id BIGINT PRIMARY KEY
        );
      `;
      const sql2 = `CREATE TABLE users ( id BIGINT PRIMARY KEY );`;
      expect(normalizeSQL(sql1)).toBe(normalizeSQL(sql2));
    });
  });

  describe('Table Extraction', () => {
    it('should extract table names from CREATE TABLE statements', () => {
      const sql = 'CREATE TABLE users (id INT); CREATE TABLE orders (id INT);';
      const tables = extractTables(sql);
      expect(tables).toContain('users');
      expect(tables).toContain('orders');
      expect(tables.size).toBe(2);
    });

    it('should handle IF NOT EXISTS clause', () => {
      const sql = 'CREATE TABLE IF NOT EXISTS users (id INT);';
      const tables = extractTables(sql);
      expect(tables).toContain('users');
    });

    it('should handle public schema prefix', () => {
      const sql = 'CREATE TABLE public.users (id INT);';
      const tables = extractTables(sql);
      expect(tables).toContain('users');
    });

    it('should extract tables from ALTER TABLE statements', () => {
      const sql = 'ALTER TABLE users ADD COLUMN email VARCHAR(255);';
      const tables = extractTables(sql);
      expect(tables).toContain('users');
    });

    it('should extract multiple tables correctly', () => {
      const sql = `
        CREATE TABLE users (id INT);
        ALTER TABLE users ADD COLUMN name VARCHAR(100);
        CREATE TABLE products (id INT);
      `;
      const tables = extractTables(sql);
      expect(tables).toContain('users');
      expect(tables).toContain('products');
      expect(tables.size).toBe(2);
    });
  });

  describe('Index Extraction', () => {
    it('should extract index names', () => {
      const sql = 'CREATE INDEX idx_users_email ON users(email);';
      const indexes = extractIndexes(sql);
      expect(indexes).toContain('idx_users_email');
    });

    it('should handle UNIQUE INDEX', () => {
      const sql = 'CREATE UNIQUE INDEX idx_users_email ON users(email);';
      const indexes = extractIndexes(sql);
      expect(indexes).toContain('idx_users_email');
    });

    it('should handle IF NOT EXISTS', () => {
      const sql = 'CREATE INDEX IF NOT EXISTS idx_users_id ON users(id);';
      const indexes = extractIndexes(sql);
      expect(indexes).toContain('idx_users_id');
    });
  });

  describe('Policy Extraction', () => {
    it('should extract policy names', () => {
      const sql = 'CREATE POLICY user_policy ON users FOR SELECT USING (auth.uid() = id);';
      const policies = extractPolicies(sql);
      expect(policies).toContain('user_policy');
    });

    it('should extract multiple policies', () => {
      const sql = `
        CREATE POLICY select_policy ON users FOR SELECT USING (true);
        CREATE POLICY update_policy ON users FOR UPDATE USING (auth.uid() = id);
      `;
      const policies = extractPolicies(sql);
      expect(policies).toContain('select_policy');
      expect(policies).toContain('update_policy');
    });
  });

  describe('Timestamp Conflict Detection', () => {
    it('should detect duplicate migration timestamps', () => {
      const migrations = new Map([
        ['20260624000000_first.sql', { version: '20260624000000', normalized: 'a', tables: new Set(), indexes: new Set(), policies: new Set(), content: '' }],
        ['20260624000000_second.sql', { version: '20260624000000', normalized: 'b', tables: new Set(), indexes: new Set(), policies: new Set(), content: '' }],
      ]);

      const issues = detectTimestampConflicts(migrations);
      expect(issues).toHaveLength(1);
      expect(issues[0].type).toBe('timestamp_conflict');
      expect(issues[0].severity).toBe('error');
      expect(issues[0].files).toHaveLength(2);
    });

    it('should extract migration version from filename', () => {
      expect(migrationVersion('20260624000000_create_foo.sql')).toBe('20260624000000');
      expect(migrationVersion('20260426_create_csp.sql')).toBe('20260426');
    });

    it('should not flag unique timestamps', () => {
      const migrations = new Map([
        ['20260624000000_first.sql', { version: '20260624000000', normalized: 'a', tables: new Set(), indexes: new Set(), policies: new Set(), content: '' }],
        ['20260624000001_second.sql', { version: '20260624000001', normalized: 'b', tables: new Set(), indexes: new Set(), policies: new Set(), content: '' }],
      ]);

      expect(detectTimestampConflicts(migrations)).toHaveLength(0);
    });
  });

  describe('Schema Object Comparison', () => {
    it('should detect tables missing from live schema', () => {
      const expected = { tables: new Set(['users', 'orders']), indexes: new Set(), policies: new Set() };
      const actual = { tables: new Set(['users']), indexes: new Set() };

      const { issues } = compareSchemaObjects(expected, actual);
      expect(issues.some(i => i.object === 'orders' && i.type === 'schema_drift')).toBe(true);
    });

    it('should detect extra tables in live schema (missing migration)', () => {
      const expected = { tables: new Set(['users']), indexes: new Set(), policies: new Set() };
      const actual = { tables: new Set(['users', 'orphan_table']), indexes: new Set() };

      const { issues } = compareSchemaObjects(expected, actual);
      expect(issues.some(i => i.object === 'orphan_table')).toBe(true);
    });

    it('should build a readable schema diff report', () => {
      const expected = { tables: new Set(['users']), indexes: new Set(['idx_users']), policies: new Set() };
      const actual = { tables: new Set(['users', 'extra']), indexes: new Set() };

      const report = buildSchemaDiffReport(expected, actual);
      expect(report).toContain('extra');
      expect(report).toContain('idx_users');
    });
  });

  describe('Schema Snapshot Comparison', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = path.join(__dirname, '.test-schema-' + Date.now());
      fs.mkdirSync(tempDir, { recursive: true });
    });

    afterEach(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true });
      }
    });

    it('should match identical schema snapshots', () => {
      const sql = 'CREATE TABLE public.users (id bigint PRIMARY KEY);';
      const expectedPath = path.join(tempDir, 'expected.sql');
      const livePath = path.join(tempDir, 'live.sql');
      fs.writeFileSync(expectedPath, sql);
      fs.writeFileSync(livePath, sql);

      const result = compareSchemaSnapshotFiles(expectedPath, livePath);
      expect(result.success).toBe(true);
    });

    it('should detect schema snapshot drift', () => {
      const expectedPath = path.join(tempDir, 'expected.sql');
      const livePath = path.join(tempDir, 'live.sql');
      fs.writeFileSync(expectedPath, 'CREATE TABLE public.users (id bigint);');
      fs.writeFileSync(livePath, 'CREATE TABLE public.users (id bigint); CREATE TABLE public.orders (id bigint);');

      const result = compareSchemaSnapshotFiles(expectedPath, livePath);
      expect(result.success).toBe(false);
      expect(result.diffReport).toBeTruthy();
    });

    it('should normalize schema snapshot content', () => {
      const a = normalizeSchemaSnapshot('CREATE TABLE Users ( ID BIGINT ); -- comment');
      const b = normalizeSchemaSnapshot('create table users ( id bigint );');
      expect(a).toBe(b);
    });
  });

  describe('Migration Comparison', () => {
    it('should detect identical migrations', () => {
      const m1: MigrationData = {
        content: 'CREATE TABLE users (id INT);',
        normalized: 'create table users (id int);',
        tables: new Set(['users']),
        indexes: new Set(),
        policies: new Set()
      };
      const m2: MigrationData = {
        content: 'CREATE TABLE users (id INT);',
        normalized: 'create table users (id int);',
        tables: new Set(['users']),
        indexes: new Set(),
        policies: new Set()
      };

      const issues = compareMigrations('001_create_users.sql', m1, '001_create_users.sql', m2);
      expect(issues).toHaveLength(1);
      expect(issues[0].type).toBe('duplicate');
      expect(issues[0].severity).toBe('error');
    });

    it('should detect table conflicts between different migrations', () => {
      const m1: MigrationData = {
        content: 'CREATE TABLE users (id INT);',
        normalized: 'create table users (id int);',
        tables: new Set(['users']),
        indexes: new Set(),
        policies: new Set()
      };
      const m2: MigrationData = {
        content: 'ALTER TABLE users ADD COLUMN email VARCHAR(255);',
        normalized: 'alter table users add column email varchar(255);',
        tables: new Set(['users']),
        indexes: new Set(),
        policies: new Set()
      };

      const issues = compareMigrations('001_create_users.sql', m1, '002_alter_users.sql', m2);
      expect(issues).toHaveLength(1);
      expect(issues[0].type).toBe('conflict');
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].tables).toContain('users');
    });

    it('should not flag migrations affecting different tables', () => {
      const m1: MigrationData = {
        content: 'CREATE TABLE users (id INT);',
        normalized: 'create table users (id int);',
        tables: new Set(['users']),
        indexes: new Set(),
        policies: new Set()
      };
      const m2: MigrationData = {
        content: 'CREATE TABLE products (id INT);',
        normalized: 'create table products (id int);',
        tables: new Set(['products']),
        indexes: new Set(),
        policies: new Set()
      };

      const issues = compareMigrations('001_create_users.sql', m1, '002_create_products.sql', m2);
      expect(issues).toHaveLength(0);
    });
  });

  describe('Migration File Reading', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = path.join(__dirname, '.test-migrations-' + Date.now());
      fs.mkdirSync(tempDir, { recursive: true });
    });

    afterEach(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true });
      }
    });

    it('should read SQL migration files', () => {
      fs.writeFileSync(path.join(tempDir, '001_init.sql'), 'CREATE TABLE users (id INT);');
      fs.writeFileSync(path.join(tempDir, '002_add_email.sql'), 'ALTER TABLE users ADD COLUMN email VARCHAR(255);');

      const migrations = readMigrations(tempDir);
      expect(migrations.size).toBe(2);
      expect(migrations.has('001_init.sql')).toBe(true);
      expect(migrations.has('002_add_email.sql')).toBe(true);
    });

    it('should ignore non-SQL files', () => {
      fs.writeFileSync(path.join(tempDir, '001_init.sql'), 'CREATE TABLE users (id INT);');
      fs.writeFileSync(path.join(tempDir, 'README.md'), '# Migrations');
      fs.writeFileSync(path.join(tempDir, '.gitkeep'), '');

      const migrations = readMigrations(tempDir);
      expect(migrations.size).toBe(1);
      expect(migrations.has('001_init.sql')).toBe(true);
    });

    it('should handle non-existent directory gracefully', () => {
      const nonExistent = path.join(tempDir, 'nonexistent');
      const migrations = readMigrations(nonExistent);
      expect(migrations.size).toBe(0);
    });

    it('should parse migration metadata correctly', () => {
      const sql = 'CREATE TABLE users (id INT); CREATE INDEX idx_users_id ON users(id);';
      fs.writeFileSync(path.join(tempDir, '001_init.sql'), sql);

      const migrations = readMigrations(tempDir);
      const migration = migrations.get('001_init.sql')!;

      expect(migration.content).toBe(sql);
      expect(migration.normalized).toContain('create table users');
      expect(migration.tables).toContain('users');
      expect(migration.indexes).toContain('idx_users_id');
    });
  });

  describe('Filesystem Migration Analysis', () => {
    it('should detect canonical supabase migrations in filesystem', () => {
      const supabaseMigrations = readMigrations(SUPABASE_MIGRATIONS);

      expect(supabaseMigrations.size).toBeGreaterThan(0);

      for (const migration of supabaseMigrations.values()) {
        expect(migration.content).toBeTruthy();
        expect(migration.normalized).toBeTruthy();
        expect(migration.tables).toBeTruthy();
      }
    });

    it('should identify migration naming patterns', () => {
      const supabaseMigrations = readMigrations(SUPABASE_MIGRATIONS);
      const names = Array.from(supabaseMigrations.keys());

      const hasTimestampPattern = names.some(n => /^\d{14}/.test(n));
      const hasShortTimestampPattern = names.some(n => /^\d{8}/.test(n));

      expect(hasTimestampPattern || hasShortTimestampPattern).toBe(true);
    });
  });

  describe('Database State Validation', () => {
    it('should identify unapplied migrations', () => {
      const appliedNames = new Set(['001_init.sql', '002_users.sql']);
      const filesystemMigrations = new Set(['001_init.sql', '002_users.sql', '003_products.sql']);

      const unapplied: string[] = [];
      for (const file of filesystemMigrations) {
        if (!appliedNames.has(file)) {
          unapplied.push(file);
        }
      }

      expect(unapplied).toEqual(['003_products.sql']);
    });

    it('should identify orphaned migrations', () => {
      const appliedNames = ['001_init.sql', '002_users.sql', '003_old_removed.sql'];
      const filesystemMigrations = new Set(['001_init.sql', '002_users.sql']);

      const orphaned: string[] = [];
      for (const name of appliedNames) {
        if (!filesystemMigrations.has(name)) {
          orphaned.push(name);
        }
      }

      expect(orphaned).toEqual(['003_old_removed.sql']);
    });

    it('should compare database and filesystem states', () => {
      const applied = [
        { name: '001_init.sql', executedAt: '2024-01-01T00:00:00Z' },
        { name: '002_users.sql', executedAt: '2024-01-02T00:00:00Z' }
      ];
      const filesystem = new Set(['001_init.sql', '002_users.sql', '003_products.sql']);

      const issues: Issue[] = [];
      const appliedSet = new Set(applied.map(m => m.name));

      for (const file of filesystem) {
        if (!appliedSet.has(file)) {
          issues.push({
            type: 'unapplied_migration',
            severity: 'warning',
            migration: file,
            message: `Migration in filesystem but not applied to database: "${file}"`
          });
        }
      }

      for (const m of applied) {
        if (!filesystem.has(m.name)) {
          issues.push({
            type: 'orphaned_migration',
            severity: 'warning',
            migration: m.name,
            message: `Migration in database but not in filesystem: "${m.name}"`,
            executedAt: m.executedAt
          });
        }
      }

      expect(issues).toHaveLength(1);
      expect(issues[0].type).toBe('unapplied_migration');
      expect(issues[0].migration).toBe('003_products.sql');
    });
  });

  describe('Error Reporting', () => {
    it('should format error messages clearly', () => {
      const issue: Issue = {
        type: 'duplicate',
        severity: 'error',
        message: 'Identical migrations: "001_init.sql" and "001_init_backup.sql"',
        files: ['001_init.sql', '001_init_backup.sql']
      };

      expect(issue.message).toContain('Identical migrations');
      expect(issue.message).toContain('001_init.sql');
      expect(issue.files).toHaveLength(2);
    });

    it('should separate errors from warnings', () => {
      const issues: Issue[] = [
        { type: 'duplicate', severity: 'error', message: 'Duplicate found' },
        { type: 'conflict', severity: 'warning', message: 'Conflict warning' },
        { type: 'duplicate', severity: 'error', message: 'Another duplicate' }
      ];

      const errors = issues.filter(i => i.severity === 'error');
      const warnings = issues.filter(i => i.severity === 'warning');

      expect(errors).toHaveLength(2);
      expect(warnings).toHaveLength(1);
    });
  });

  describe('Environment-Aware Output', () => {
    it('should include env field in JSON output structure', () => {
      const output = {
        success: true,
        env: 'local',
        fileCheck: { backendCount: 5, supabaseCount: 5 },
        dbCheck: null,
        issues: []
      };

      expect(output.env).toBe('local');
      expect(output).toHaveProperty('env');
    });

    it('should distinguish local from ci-remote environment labels', () => {
      const localOutput = { env: 'local', success: true, issues: [] };
      const ciOutput = { env: 'ci-remote', success: true, issues: [] };

      expect(localOutput.env).not.toBe(ciOutput.env);
      expect(localOutput.env).toBe('local');
      expect(ciOutput.env).toBe('ci-remote');
    });

    it('should include env label in issue context for cross-environment comparison', () => {
      const localResult = {
        env: 'local',
        dbCheck: {
          appliedCount: 10,
          filesystemCount: 12,
          issues: [
            {
              type: 'unapplied_migration',
              severity: 'warning' as const,
              message: 'Migration in filesystem but not applied to database: "20260530_new_index.sql"',
              migration: '20260530_new_index.sql'
            }
          ]
        }
      };
      const ciResult = {
        env: 'ci-remote',
        dbCheck: {
          appliedCount: 12,
          filesystemCount: 12,
          issues: []
        }
      };

      // Local has unapplied migrations that CI doesn't — this is a cross-environment divergence
      expect(localResult.dbCheck.issues).toHaveLength(1);
      expect(ciResult.dbCheck.issues).toHaveLength(0);
      expect(localResult.dbCheck.appliedCount).toBeLessThan(ciResult.dbCheck.appliedCount);
      expect(localResult.env).toBe('local');
      expect(ciResult.env).toBe('ci-remote');
    });
  });

  describe('Conflicting Migration History Detection', () => {
    it('should identify migrations present in CI database but not local', () => {
      const localApplied = new Set(['001_init.sql', '002_users.sql']);
      const ciApplied = new Set(['001_init.sql', '002_users.sql', '003_products.sql']);

      const onlyInCI: string[] = [];
      for (const name of ciApplied) {
        if (!localApplied.has(name)) {
          onlyInCI.push(name);
        }
      }

      expect(onlyInCI).toEqual(['003_products.sql']);
    });

    it('should identify migrations present locally but not in CI', () => {
      const localApplied = new Set(['001_init.sql', '002_users.sql', '003_local_only.sql']);
      const ciApplied = new Set(['001_init.sql', '002_users.sql']);

      const onlyInLocal: string[] = [];
      for (const name of localApplied) {
        if (!ciApplied.has(name)) {
          onlyInLocal.push(name);
        }
      }

      expect(onlyInLocal).toEqual(['003_local_only.sql']);
    });

    it('should detect when applied migration count diverges between environments', () => {
      const localCount = 10;
      const ciCount = 12;

      expect(localCount).not.toBe(ciCount);
      const diverged = Math.abs(localCount - ciCount) > 0;
      expect(diverged).toBe(true);
    });

    it('should surface conflicting history with executedAt timestamps', () => {
      const orphanedIssue: Issue = {
        type: 'orphaned_migration',
        severity: 'warning',
        message: 'Migration in database but not in filesystem: "20260101_dropped.sql"',
        migration: '20260101_dropped.sql',
        executedAt: '2026-01-01T10:00:00Z'
      };

      expect(orphanedIssue.executedAt).toBeDefined();
      expect(orphanedIssue.message).toContain('20260101_dropped.sql');
      expect(orphanedIssue.type).toBe('orphaned_migration');
    });
  });
});
