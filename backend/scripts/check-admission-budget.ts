#!/usr/bin/env node
/**
 * Admission Budget CI Gate
 *
 * This script checks if the admission p99 latency meets the configured budget.
 * It fails with a non-zero exit code if the budget is exceeded, which gates CI.
 *
 * Usage:
 *   npx ts-node backend/scripts/check-admission-budget.ts
 *
 * Environment variables:
 *   ADMISSION_TOTAL_BUDGET_MS - Total budget in ms (default: 50)
 *   ADMISSION_MIN_SAMPLES_P99 - Minimum samples for p99 (default: 100)
 *   ADMISSION_P99_WINDOW_MS - Window for p99 calculation (default: 300000)
 */

import { loadAdmissionConfig } from '../config/admission';
import { admissionService } from '../services/admission-service';
import logger from '../config/logger';

// Colors for terminal output
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

function colorize(text: string, color: string): string {
  return `${color}${text}${RESET}`;
}

async function main(): Promise<void> {
  console.log(colorize('\n🔍 Admission Budget CI Gate', BLUE));
  console.log('═'.repeat(50));

  const config = loadAdmissionConfig();

  console.log(`\n📋 Configuration:`);
  console.log(`   Total Budget: ${config.budget.totalBudgetMs}ms (p99)`);
  console.log(`   Step Budgets:`);
  console.log(`     - Identity Resolution: ${config.budget.stepBudgets.identityResolutionMs}ms`);
  console.log(`     - Scope Read: ${config.budget.stepBudgets.scopeReadMs}ms`);
  console.log(`     - Cap Check: ${config.budget.stepBudgets.capCheckMs}ms`);
  console.log(`     - Meter Reserve: ${config.budget.stepBudgets.meterReserveMs}ms`);
  console.log(`   Enforcement: ${config.budget.enableBudgetEnforcement ? 'enabled' : 'disabled'}`);
  console.log(`   Min Samples for p99: ${config.budget.minSamplesForP99}`);
  console.log(`   p99 Window: ${config.budget.p99WindowMs / 1000}s`);

  if (!config.budget.enableBudgetEnforcement) {
    console.log(colorize('\n⚠️  Budget enforcement is disabled. Skipping check.', YELLOW));
    process.exit(0);
  }

  // Get budget status
  const status = admissionService.getBudgetStatus();

  console.log(`\n📊 Current Status:`);
  console.log(`   Sample Count: ${status.sampleCount}`);
  console.log(`   p99 Latency: ${status.p99LatencyMs}ms`);
  console.log(`   Budget: ${status.budgetMs}ms`);
  console.log(`   Recent Violations: ${status.recentViolations}`);

  if (status.sampleCount < config.budget.minSamplesForP99) {
    console.log(colorize(`\n⚠️  Insufficient samples (${status.sampleCount}/${config.budget.minSamplesForP99}) for reliable p99 calculation.`, YELLOW));
    console.log(colorize('    This is expected on first run or in test environments.', YELLOW));
    console.log(colorize('    CI gate will pass but p99 is not statistically meaningful.', YELLOW));
    process.exit(0);
  }

  const compliant = status.compliant;
  const margin = status.budgetMs - status.p99LatencyMs;
  const marginPercent = ((margin / status.budgetMs) * 100).toFixed(1);

  console.log(`\n${compliant ? colorize('✅ PASS', GREEN) : colorize('❌ FAIL', RED)}`);
  console.log(`   p99: ${status.p99LatencyMs}ms vs Budget: ${status.budgetMs}ms`);
  console.log(`   Margin: ${margin}ms (${marginPercent}% ${compliant ? 'under' : 'over'} budget)`);

  if (!compliant) {
    console.log(colorize('\n🚨 BUDGET EXCEEDED', RED));
    console.log('   The admission path p99 latency exceeds the configured budget.');
    console.log('   This will fail CI. Please investigate the latency sources.');
    console.log('\n   Possible causes:');
    console.log('   - Database queries too slow (add indexes, optimize queries)');
    console.log('   - Cache misses (check Redis connectivity, increase cache TTL)');
    console.log('   - External service calls blocking (use parallelization)');
    console.log('   - New admission check added without budget allocation');
    console.log('\n   Fix options:');
    console.log('   - Optimize slow steps identified in stepLatencies');
    console.log('   - Increase cache TTL or enable parallel checks');
    console.log('   - If budget increase is justified, update ADMISSION_TOTAL_BUDGET_MS');
    process.exit(1);
  }

  console.log(colorize('\n🎉 Budget check passed!', GREEN));
  process.exit(0);
}

// Run the check
main().catch((error) => {
  logger.error('Admission budget check failed:', error);
  console.error(colorize('\n💥 Script error:', RED), error);
  process.exit(2);
});