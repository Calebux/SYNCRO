#!/usr/bin/env node

/**
 * Bundle Size Check Script
 *
 * Reads the Next.js build output and enforces route-level and chunk-level
 * budgets defined in bundle-size.json. Exits with code 1 on any violation.
 *
 * Usage: node scripts/check-bundle-size.js [options]
 *   --json       Output results as JSON (useful for CI)
 *   --root=<dir> Specify client root directory (default: parent of scripts/)
 */

const fs = require('fs');
const path = require('path');
const { gzipSync } = require('zlib');

function resolveRoot(argv) {
  const rootFlag = argv.find(a => a.startsWith('--root='));
  if (rootFlag) return path.resolve(rootFlag.slice(7));
  return path.resolve(__dirname, '..');
}

const ROOT = resolveRoot(process.argv);
const BUDGET_PATH = path.join(ROOT, 'bundle-size.json');
const BUILD_MANIFEST_PATH = path.join(ROOT, '.next', 'build-manifest.json');
const CHUNKS_DIR = path.join(ROOT, '.next', 'static', 'chunks');
const APP_CHUNKS_DIR = path.join(CHUNKS_DIR, 'app');

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function formatKB(bytes) {
  return (bytes / 1024).toFixed(1);
}

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

function getFileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function getGzipSize(bytes) {
  return gzipSync(Buffer.alloc(bytes)).length;
}

/**
 * Maps a route path to the expected app chunk filename pattern.
 * Next.js app router generates chunks like:
 *   app/page.js                -> /
 *   app/dashboard/page.js      -> /dashboard
 *   app/dashboard/analytics/page.js -> /dashboard/analytics
 */
function routeToChunkPrefix(route) {
  if (route === '/') return 'app/page';
  const normalized = route.replace(/\/$/, '');
  return `app${normalized}/page`;
}

/**
 * Finds the app chunk file(s) for a given route prefix.
 * Next.js generates hashed filenames like `app-page-abc123.js`
 */
function findChunkFilesForRoute(prefix) {
  if (!fs.existsSync(APP_CHUNKS_DIR)) return [];
  const files = fs.readdirSync(APP_CHUNKS_DIR);
  const safePrefix = prefix.replace(/\//g, '-');
  return files
    .filter(f => f.startsWith(safePrefix) && f.endsWith('.js'))
    .map(f => path.join(APP_CHUNKS_DIR, f));
}

function loadBudgets(budgetPath) {
  const budgets = readJSON(budgetPath || BUDGET_PATH);
  if (!budgets) {
    log('❌ bundle-size.json not found. Run from client directory.', 'red');
    process.exit(1);
  }
  return budgets.budgets;
}

/**
 * Measures actual sizes of build output.
 */
function measureBuild(buildManifest, chunksDir, appChunksDir, rootDir) {
  const cd = chunksDir || CHUNKS_DIR;
  const acd = appChunksDir || APP_CHUNKS_DIR;

  if (!fs.existsSync(cd)) {
    log('❌ No chunks directory found. Has the client been built?', 'red');
    log('   Run: npm run build (with ANALYZE=true for detailed analysis)', 'yellow');
    process.exit(1);
  }

  const rootMainFiles = buildManifest?.rootMainFiles || [];
  const allChunks = new Map();
  const sharedChunks = [];

  for (const file of rootMainFiles) {
    const filePath = path.join(cd, file);
    const size = getFileSize(filePath);
    if (size > 0) {
      sharedChunks.push({ name: file, size });
      allChunks.set(file, size);
    }
  }

  const polyfillFiles = buildManifest?.polyfillFiles || [];
  for (const file of polyfillFiles) {
    const filePath = path.join(cd, file);
    const size = getFileSize(filePath);
    if (size > 0) {
      sharedChunks.push({ name: file, size });
      allChunks.set(file, size);
    }
  }

  const routes = new Map();

  const budgetRoutes = Object.keys(loadBudgets().perRoute);

  for (const route of budgetRoutes) {
    const prefix = routeToChunkPrefix(route);
    const routeChunks = [];

    const chunkFiles = findChunkFilesForRoute(prefix);
    for (const filePath of chunkFiles) {
      const name = path.basename(filePath);
      const size = getFileSize(filePath);
      if (size > 0) {
        routeChunks.push({ name, size, filePath });
        allChunks.set(name, size);
      }
    }

    const routeSize = routeChunks.reduce((sum, c) => sum + c.size, 0);
    const sharedSize = sharedChunks.reduce((sum, c) => sum + c.size, 0);
    const totalSize = routeSize + sharedSize;

    routes.set(route, {
      chunks: routeChunks,
      routeSize,
      sharedSize,
      totalSize,
      gzipSize: getGzipSize(totalSize),
    });
  }

  const totalChunkSize = Array.from(allChunks.values()).reduce((sum, s) => sum + s, 0);

  const individualChunks = [];
  for (const [name, size] of allChunks) {
    individualChunks.push({ name, size });
  }

  return {
    sharedChunks,
    routes: Object.fromEntries(routes),
    allChunks: individualChunks,
    totalChunkSize,
  };
}

/**
 * Checks all measured sizes against budgets.
 * Pure function - no side effects, no file I/O.
 */
function checkBudgets(measurement, budgets) {
  const violations = [];
  const warnings = [];

  if (measurement.totalChunkSize / 1024 > budgets.total) {
    violations.push({
      type: 'total',
      actual: formatKB(measurement.totalChunkSize),
      budget: budgets.total,
      message: `Total JS ${formatKB(measurement.totalChunkSize)} KB exceeds budget of ${budgets.total} KB`,
    });
  }

  const sharedTotal = measurement.sharedChunks.reduce((s, c) => s + c.size, 0);
  if (sharedTotal / 1024 > budgets.shared) {
    violations.push({
      type: 'shared',
      actual: formatKB(sharedTotal),
      budget: budgets.shared,
      message: `Shared JS ${formatKB(sharedTotal)} KB exceeds budget of ${budgets.shared} KB`,
    });
  }

  for (const [route, routeData] of Object.entries(measurement.routes)) {
    const budget = budgets.perRoute[route];
    if (budget === undefined) continue;

    const sizeKB = routeData.totalSize / 1024;
    if (sizeKB > budget) {
      violations.push({
        type: 'route',
        route,
        actual: formatKB(routeData.totalSize),
        budget,
        message: `Route "${route}" is ${formatKB(routeData.totalSize)} KB, exceeds budget of ${budget} KB`,
      });
    } else if (sizeKB > budget * 0.9) {
      warnings.push({
        type: 'route',
        route,
        actual: formatKB(routeData.totalSize),
        budget,
        message: `Route "${route}" is ${formatKB(routeData.totalSize)} KB, approaching budget of ${budget} KB (${(sizeKB / budget * 100).toFixed(0)}%)`,
      });
    }
  }

  for (const chunk of measurement.allChunks) {
    const chunkSizeKB = chunk.size / 1024;
    if (chunkSizeKB > budgets.perChunk) {
      violations.push({
        type: 'chunk',
        chunk: chunk.name,
        actual: formatKB(chunk.size),
        budget: budgets.perChunk,
        message: `Chunk "${chunk.name}" is ${formatKB(chunk.size)} KB, exceeds per-chunk budget of ${budgets.perChunk} KB`,
      });
    }
  }

  return { violations, warnings };
}

function printReport(measurement, result, isJson) {
  if (isJson) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      measurement: {
        totalJS: formatKB(measurement.totalChunkSize),
        routes: Object.fromEntries(
          Object.entries(measurement.routes).map(([route, data]) => [
            route,
            { totalKB: formatKB(data.totalSize), routeKB: formatKB(data.routeSize), sharedKB: formatKB(data.sharedSize), gzipKB: formatKB(data.gzipSize) },
          ])
        ),
        sharedChunks: measurement.sharedChunks.map(c => ({ name: c.name, sizeKB: formatKB(c.size) })),
      },
      result,
    }));
    return;
  }

  log('\n' + '='.repeat(60), 'cyan');
  log('  📦 Bundle Size Report', 'bold');
  log('='.repeat(60), 'cyan');

  log(`\nTotal JS: ${formatKB(measurement.totalChunkSize)} KB (gzip ~${formatKB(measurement.totalChunkSize * 0.35)} KB est.)`, 'bold');

  log('\n── Shared Chunks ──', 'cyan');
  for (const chunk of measurement.sharedChunks) {
    log(`  ${chunk.name}: ${formatKB(chunk.size)} KB`);
  }

  log('\n── Routes ──', 'cyan');
  const sortedRoutes = Object.entries(measurement.routes).sort((a, b) => b[1].totalSize - a[1].totalSize);

  for (const [route, data] of sortedRoutes) {
    const budget = loadBudgets().perRoute[route];
    const pct = budget ? (data.totalSize / 1024 / budget * 100).toFixed(0) : '?';
    const overBudget = budget && data.totalSize / 1024 > budget;
    const color = overBudget ? 'red' : data.totalSize / 1024 > (budget || Infinity) * 0.9 ? 'yellow' : 'green';
    log(
      `  ${route.padEnd(30)} ${formatKB(data.totalSize).padStart(8)} KB` +
      `  (page: ${formatKB(data.routeSize).padStart(6)} KB + shared: ${formatKB(data.sharedSize).padStart(6)} KB)` +
      `  [${pct}% of budget]`,
      color,
    );
  }

  log('\n── Individual Chunks ──', 'cyan');
  const sortedChunks = measurement.allChunks.sort((a, b) => b.size - a.size);
  for (const chunk of sortedChunks.slice(0, 20)) {
    const color = chunk.size / 1024 > loadBudgets().perChunk ? 'red' : 'green';
    log(`  ${chunk.name.padEnd(50)} ${formatKB(chunk.size).padStart(8)} KB`, color);
  }
  if (sortedChunks.length > 20) {
    log(`  ... and ${sortedChunks.length - 20} more chunks`);
  }

  if (result.warnings.length > 0) {
    log('\n── Warnings ──', 'yellow');
    for (const w of result.warnings) {
      log(`  ⚠️  ${w.message}`, 'yellow');
    }
  }

  if (result.violations.length > 0) {
    log('\n── Violations ──', 'red');
    for (const v of result.violations) {
      log(`  ❌ ${v.message}`, 'red');
    }
  }

  const pass = result.violations.length === 0;
  log('\n' + '='.repeat(60), 'cyan');
  if (pass) {
    log('  ✅ All bundle size budgets met!', 'green');
  } else {
    log(`  ❌ ${result.violations.length} violation(s) found — fix before merging.`, 'red');
  }
  log('='.repeat(60) + '\n', 'cyan');
}

function main() {
  const isJson = process.argv.includes('--json');

  const budgets = loadBudgets();
  const buildManifest = readJSON(BUILD_MANIFEST_PATH);

  if (!buildManifest) {
    log('❌ build-manifest.json not found. Run `npm run build` first.', 'red');
    process.exit(1);
  }

  const measurement = measureBuild(buildManifest);
  const result = checkBudgets(measurement, budgets);

  printReport(measurement, result, isJson);

  if (result.violations.length > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  routeToChunkPrefix,
  formatKB,
  getFileSize,
  getGzipSize,
  checkBudgets,
  measureBuild,
  loadBudgets,
};
