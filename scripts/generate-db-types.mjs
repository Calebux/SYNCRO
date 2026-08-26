#!/usr/bin/env node
/**
 * Build a migration-derived schema snapshot and generate database row types.
 *
 * Reads supabase/migrations/*.sql in filename order, applies CREATE/ALTER TABLE,
 * writes:
 *   supabase/schema.snapshot.json
 *   shared/src/generated/database.ts
 *
 * Does not require a live database. `scripts/generate-schema-snapshot.sh`
 * still dumps SQL from a running local instance when available.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');
const SNAPSHOT_JSON = path.join(ROOT, 'supabase', 'schema.snapshot.json');
const OUTPUT_TS = path.join(ROOT, 'shared', 'src', 'generated', 'database.ts');

const CONSTRAINT_START =
  /^(constraint|primary\s+key|unique|check|foreign\s+key|exclude|like)\b/i;

function stripComments(sql) {
  let out = '';
  let i = 0;
  let inSingle = false;
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (!inSingle && two === '--') {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? sql.length : nl;
      continue;
    }
    if (!inSingle && two === '/*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    if (sql[i] === "'" && sql[i - 1] !== '\\') {
      inSingle = !inSingle;
    }
    out += sql[i];
    i += 1;
  }
  return out;
}

function splitStatements(sql) {
  const stmts = [];
  let current = '';
  let inSingle = false;
  let dollar = null;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (!inSingle && ch === '$') {
      const m = sql.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (m) {
        const tag = m[0];
        if (dollar === tag) {
          dollar = null;
        } else if (!dollar) {
          dollar = tag;
        }
        current += tag;
        i += tag.length - 1;
        continue;
      }
    }
    if (!dollar && ch === "'" && sql[i - 1] !== '\\') {
      inSingle = !inSingle;
    }
    if (ch === ';' && !inSingle && !dollar) {
      const trimmed = current.trim();
      if (trimmed) stmts.push(trimmed);
      current = '';
      continue;
    }
    current += ch;
  }
  const tail = current.trim();
  if (tail) stmts.push(tail);
  return stmts;
}

function splitTopLevel(body, sep = ',') {
  const parts = [];
  let current = '';
  let depth = 0;
  let inSingle = false;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === "'" && body[i - 1] !== '\\') inSingle = !inSingle;
    if (!inSingle) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
      if (ch === sep && depth === 0) {
        const trimmed = current.trim();
        if (trimmed) parts.push(trimmed);
        current = '';
        continue;
      }
    }
    current += ch;
  }
  const tail = current.trim();
  if (tail) parts.push(tail);
  return parts;
}

function normalizeTableName(raw) {
  return raw
    .replace(/"/g, '')
    .replace(/^public\./i, '')
    .replace(/^auth\./i, 'auth.')
    .trim();
}

function pgTypeToTs(rawType) {
  const t = rawType
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/"/g, '')
    .trim();
  if (t.endsWith('[]')) {
    return `${pgTypeToTs(t.slice(0, -2).trim())}[]`;
  }
  const base = t.replace(/\([^)]*\)/g, '').trim();
  if (
    base.startsWith('timestamp') ||
    base.startsWith('date') ||
    base.startsWith('time') ||
    base === 'uuid' ||
    base === 'text' ||
    base === 'citext' ||
    base.includes('char') ||
    base === 'bytea' ||
    base === 'inet' ||
    base === 'cidr' ||
    base === 'macaddr' ||
    base === 'xml' ||
    base === 'name' ||
    base.startsWith('interval')
  ) {
    return 'string';
  }
  if (base === 'json' || base === 'jsonb') return 'Json';
  if (base.startsWith('bool')) return 'boolean';
  if (
    base.startsWith('int') ||
    base === 'smallint' ||
    base === 'bigint' ||
    base === 'real' ||
    base.startsWith('double') ||
    base.startsWith('numeric') ||
    base.startsWith('decimal') ||
    base.startsWith('float') ||
    base === 'serial' ||
    base === 'bigserial' ||
    base === 'smallserial' ||
    base === 'money'
  ) {
    return 'number';
  }
  return 'string';
}

function parseColumn(def) {
  const trimmed = def.trim();
  if (CONSTRAINT_START.test(trimmed)) return null;
  const nameMatch = trimmed.match(/^("?[A-Za-z_][A-Za-z0-9_]*"?)/);
  if (!nameMatch) return null;
  const name = nameMatch[1].replace(/"/g, '');
  if (/^(primary|unique|constraint|check|foreign|exclude|like)$/i.test(name)) {
    return null;
  }
  let rest = trimmed.slice(nameMatch[1].length).trim();
  // type is tokens until a constraint keyword
  const typeMatch = rest.match(
    /^([A-Za-z][A-Za-z0-9_ ]*(?:\([^)]*\))?(?:\s*\[\])?)/,
  );
  if (!typeMatch) return null;
  const pgType = typeMatch[1].trim();
  rest = rest.slice(typeMatch[1].length);
  const upper = rest.toUpperCase();
  const notNull = /\bNOT\s+NULL\b/.test(upper);
  const hasDefault = /\bDEFAULT\b/.test(upper);
  const primaryKey = /\bPRIMARY\s+KEY\b/.test(upper);
  return {
    name,
    pgType,
    tsType: pgTypeToTs(pgType),
    nullable: !notNull && !primaryKey,
    hasDefault: hasDefault || primaryKey,
  };
}

function ensureTable(schema, tableName) {
  if (!schema.tables[tableName]) {
    schema.tables[tableName] = { name: tableName, columns: {} };
  }
  return schema.tables[tableName];
}

function applyCreateTable(schema, stmt) {
  const m = stmt.match(
    /^create\s+table\s+(?:if\s+not\s+exists\s+)?([^\s(]+)\s*\(([\s\S]*)\)\s*$/i,
  );
  if (!m) return;
  const tableName = normalizeTableName(m[1]);
  const table = ensureTable(schema, tableName);
  for (const part of splitTopLevel(m[2])) {
    const col = parseColumn(part);
    if (col) table.columns[col.name] = col;
  }
}

function applyDropTable(schema, stmt) {
  const m = stmt.match(
    /^drop\s+table\s+(?:if\s+exists\s+)?([^\s;]+)/i,
  );
  if (!m) return;
  const tableName = normalizeTableName(m[1]);
  delete schema.tables[tableName];
}

function applyAlterTable(schema, stmt) {
  const m = stmt.match(/^alter\s+table\s+(?:if\s+exists\s+)?([^\s]+)\s+([\s\S]+)$/i);
  if (!m) return;
  const tableName = normalizeTableName(m[1]);
  const actionsRaw = m[2].trim();
  if (/^(enable|disable)\s+row\s+level\s+security/i.test(actionsRaw)) return;
  if (/^(owner|replica|force|set|reset|inherit|no\s+inherit)/i.test(actionsRaw)) return;

  const table = ensureTable(schema, tableName);
  const actions = splitTopLevel(actionsRaw);

  for (const action of actions) {
    let add = action.match(
      /^add\s+column\s+(?:if\s+not\s+exists\s+)?([\s\S]+)$/i,
    );
    if (add) {
      const col = parseColumn(add[1]);
      if (col) table.columns[col.name] = col;
      continue;
    }
    const drop = action.match(
      /^drop\s+column\s+(?:if\s+exists\s+)?("?[A-Za-z_][A-Za-z0-9_]*"?)/i,
    );
    if (drop) {
      delete table.columns[drop[1].replace(/"/g, '')];
      continue;
    }
    const renameCol = action.match(
      /^rename\s+column\s+("?[A-Za-z_][A-Za-z0-9_]*"?)\s+to\s+("?[A-Za-z_][A-Za-z0-9_]*"?)/i,
    );
    if (renameCol) {
      const from = renameCol[1].replace(/"/g, '');
      const to = renameCol[2].replace(/"/g, '');
      if (table.columns[from]) {
        table.columns[to] = { ...table.columns[from], name: to };
        delete table.columns[from];
      }
      continue;
    }
    const renameTable = action.match(/^rename\s+to\s+([^\s]+)/i);
    if (renameTable) {
      const next = normalizeTableName(renameTable[1]);
      schema.tables[next] = table;
      table.name = next;
      delete schema.tables[tableName];
      continue;
    }
    const alterType = action.match(
      /^alter\s+column\s+("?[A-Za-z_][A-Za-z0-9_]*"?)\s+(?:set\s+data\s+type|type)\s+([A-Za-z][A-Za-z0-9_ ]*(?:\([^)]*\))?)/i,
    );
    if (alterType) {
      const name = alterType[1].replace(/"/g, '');
      const pgType = alterType[2].trim();
      const existing = table.columns[name] || {
        name,
        nullable: true,
        hasDefault: false,
      };
      table.columns[name] = {
        ...existing,
        pgType,
        tsType: pgTypeToTs(pgType),
      };
      continue;
    }
    const setNull = action.match(
      /^alter\s+column\s+("?[A-Za-z_][A-Za-z0-9_]*"?)\s+drop\s+not\s+null/i,
    );
    if (setNull) {
      const name = setNull[1].replace(/"/g, '');
      if (table.columns[name]) table.columns[name].nullable = true;
      continue;
    }
    const dropNull = action.match(
      /^alter\s+column\s+("?[A-Za-z_][A-Za-z0-9_]*"?)\s+set\s+not\s+null/i,
    );
    if (dropNull) {
      const name = dropNull[1].replace(/"/g, '');
      if (table.columns[name]) table.columns[name].nullable = false;
      continue;
    }
    const setDefault = action.match(
      /^alter\s+column\s+("?[A-Za-z_][A-Za-z0-9_]*"?)\s+set\s+default/i,
    );
    if (setDefault) {
      const name = setDefault[1].replace(/"/g, '');
      if (table.columns[name]) table.columns[name].hasDefault = true;
    }
  }
}

function buildSchema() {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const schema = { tables: {} };
  for (const file of files) {
    const sql = stripComments(
      fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'),
    );
    for (const stmt of splitStatements(sql)) {
      if (/^create\s+table\b/i.test(stmt)) applyCreateTable(schema, stmt);
      else if (/^alter\s+table\b/i.test(stmt)) applyAlterTable(schema, stmt);
      else if (/^drop\s+table\b/i.test(stmt)) applyDropTable(schema, stmt);
    }
  }
  return {
    source: 'supabase/migrations',
    tables: Object.keys(schema.tables)
      .sort()
      .map((name) => {
        const table = schema.tables[name];
        return {
          name,
          columns: Object.keys(table.columns)
            .sort()
            .map((colName) => {
              const c = table.columns[colName];
              return {
                name: c.name,
                pgType: c.pgType,
                tsType: c.tsType,
                nullable: c.nullable,
                hasDefault: c.hasDefault,
              };
            }),
        };
      }),
  };
}

function pascalCase(name) {
  return name
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}

function emitDatabaseTs(snapshot) {
  const lines = [
    '/**',
    ' * AUTO-GENERATED — do not edit manually.',
    ' * Source: supabase/migrations (see supabase/schema.snapshot.json).',
    ' * Regenerate: npm run generate:db -w shared',
    ' */',
    '',
    'export type Json =',
    '  | string',
    '  | number',
    '  | boolean',
    '  | null',
    '  | { [key: string]: Json | undefined }',
    '  | Json[];',
    '',
    'export interface Database {',
    '  public: {',
    '    Tables: {',
  ];

  for (const table of snapshot.tables) {
    lines.push(`      ${JSON.stringify(table.name)}: {`);
    lines.push('        Row: {');
    if (table.columns.length === 0) {
      lines.push('          [key: string]: never;');
    } else {
      for (const col of table.columns) {
        const optional = col.nullable ? ' | null' : '';
        lines.push(`          ${col.name}: ${col.tsType}${optional};`);
      }
    }
    lines.push('        };');
    lines.push('        Insert: {');
    if (table.columns.length === 0) {
      lines.push('          [key: string]: never;');
    } else {
      for (const col of table.columns) {
        const optional = col.nullable || col.hasDefault ? '?' : '';
        const nullUnion = col.nullable ? ' | null' : '';
        lines.push(`          ${col.name}${optional}: ${col.tsType}${nullUnion};`);
      }
    }
    lines.push('        };');
    lines.push('        Update: {');
    if (table.columns.length === 0) {
      lines.push('          [key: string]: never;');
    } else {
      for (const col of table.columns) {
        const nullUnion = col.nullable ? ' | null' : '';
        lines.push(`          ${col.name}?: ${col.tsType}${nullUnion};`);
      }
    }
    lines.push('        };');
    lines.push('      };');
  }

  lines.push('    };');
  lines.push('  };');
  lines.push('}');
  lines.push('');
  lines.push('export type PublicTables = Database["public"]["Tables"];');
  lines.push('');

  for (const table of snapshot.tables) {
    const ident = pascalCase(table.name);
    lines.push(
      `export type ${ident}Row = PublicTables[${JSON.stringify(table.name)}]["Row"];`,
    );
    lines.push(
      `export type ${ident}Insert = PublicTables[${JSON.stringify(table.name)}]["Insert"];`,
    );
    lines.push(
      `export type ${ident}Update = PublicTables[${JSON.stringify(table.name)}]["Update"];`,
    );
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function main() {
  const snapshot = buildSchema();
  fs.mkdirSync(path.dirname(SNAPSHOT_JSON), { recursive: true });
  fs.mkdirSync(path.dirname(OUTPUT_TS), { recursive: true });
  fs.writeFileSync(SNAPSHOT_JSON, `${JSON.stringify(snapshot, null, 2)}\n`);
  fs.writeFileSync(OUTPUT_TS, emitDatabaseTs(snapshot));
  console.log(
    `Wrote ${snapshot.tables.length} tables → ${path.relative(ROOT, SNAPSHOT_JSON)} and ${path.relative(ROOT, OUTPUT_TS)}`,
  );
}

main();
