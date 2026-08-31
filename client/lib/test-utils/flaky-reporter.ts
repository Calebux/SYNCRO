/**
 * Custom Playwright Reporter for Flaky Test Detection
 * 
 * Integrates with Playwright's reporter API to track test retries and failures,
 * identifying flaky tests automatically during E2E test runs.
 * 
 * **Validates: Requirements 6.4, 6.6**
 */

import type {
  Reporter,
  FullConfig,
  Suite,
  TestCase,
  TestResult,
  FullResult,
} from '@playwright/test/reporter';
import path from 'path';
import fs from 'fs';

interface FlakyTestRecord {
  testId: string;
  title: string;
  file: string;
  location: string;
  attempts: number;
  failures: number;
  passes: number;
  retries: number;
  lastStatus: 'passed' | 'failed' | 'timedOut' | 'skipped';
  duration: number;
  errors: string[];
  timestamp: string;
}

interface FlakyReportData {
  generatedAt: string;
  totalTests: number;
  flakyTests: FlakyTestRecord[];
  summary: {
    totalFlaky: number;
    flakyRate: number;
    testsWithRetries: number;
  };
}

export default class FlakyReporter implements Reporter {
  private flakyTests: Map<string, FlakyTestRecord> = new Map();
  private totalTests = 0;
  private outputFile: string;

  constructor(options: { outputFile?: string } = {}) {
    this.outputFile = options.outputFile || path.join(process.cwd(), 'test-results/flaky-tests.json');
  }

  onBegin(config: FullConfig, suite: Suite) {
    console.log(`Starting Playwright test run with flaky test detection...`);
    this.flakyTests.clear();
    this.totalTests = 0;
  }

  onTestBegin(test: TestCase, result: TestResult) {
    // Track test start
  }

  onTestEnd(test: TestCase, result: TestResult) {
    this.totalTests++;

    const testId = this.getTestId(test);
    const isFlaky = result.retry > 0 || (result.status === 'passed' && result.retry > 0);

    // Get or create test record
    let record = this.flakyTests.get(testId);
    if (!record) {
      record = {
        testId,
        title: test.title,
        file: path.relative(process.cwd(), test.location.file),
        location: `${test.location.file}:${test.location.line}`,
        attempts: 0,
        failures: 0,
        passes: 0,
        retries: 0,
        lastStatus: result.status,
        duration: result.duration,
        errors: [],
        timestamp: new Date().toISOString(),
      };
    }

    // Update record
    record.attempts++;
    record.retries = Math.max(record.retries, result.retry);
    record.lastStatus = result.status;
    record.duration = result.duration;

    if (result.status === 'passed') {
      record.passes++;
    } else if (result.status === 'failed' || result.status === 'timedOut') {
      record.failures++;
      if (result.error) {
        record.errors.push(this.formatError(result.error));
      }
    }

    // Only track as flaky if it had retries
    if (record.retries > 0) {
      this.flakyTests.set(testId, record);
    }
  }

  onStepBegin(test: TestCase, result: TestResult) {
    // Track step start (optional, for detailed tracking)
  }

  onStepEnd(test: TestCase, result: TestResult) {
    // Track step end (optional, for detailed tracking)
  }

  async onEnd(result: FullResult) {
    console.log(`\n📊 Flaky Test Detection Report`);
    console.log(`═══════════════════════════════════════════════`);

    const flakyTestsArray = Array.from(this.flakyTests.values());
    const testsWithRetries = flakyTestsArray.length;
    const flakyRate = this.totalTests > 0 ? (testsWithRetries / this.totalTests) * 100 : 0;

    console.log(`Total Tests: ${this.totalTests}`);
    console.log(`Tests with Retries: ${testsWithRetries}`);
    console.log(`Flaky Rate: ${flakyRate.toFixed(2)}%`);

    if (flakyTestsArray.length > 0) {
      console.log(`\n⚠️  Flaky Tests Detected:\n`);

      for (const test of flakyTestsArray) {
        console.log(`  • ${test.title}`);
        console.log(`    File: ${test.file}`);
        console.log(`    Attempts: ${test.attempts} | Passes: ${test.passes} | Failures: ${test.failures} | Retries: ${test.retries}`);
        console.log(`    Last Status: ${test.lastStatus}`);
        if (test.errors.length > 0) {
          console.log(`    Last Error: ${test.errors[test.errors.length - 1]}`);
        }
        console.log('');
      }

      console.log(`\n💡 Recommendations:`);
      console.log(`  1. Review flaky tests for timing issues or race conditions`);
      console.log(`  2. Add appropriate waits (waitForSelector, waitForLoadState)`);
      console.log(`  3. Ensure tests are isolated and don't depend on external state`);
      console.log(`  4. Consider increasing timeout for slow operations`);
    } else {
      console.log(`\n✅ No flaky tests detected!`);
    }

    // Generate report file
    await this.generateReportFile(flakyTestsArray, flakyRate, testsWithRetries);

    console.log(`\n📄 Full report saved to: ${this.outputFile}`);
    console.log(`═══════════════════════════════════════════════\n`);
  }

  private getTestId(test: TestCase): string {
    return `${test.location.file}::${test.titlePath().join(' > ')}`;
  }

  private formatError(error: any): string {
    if (typeof error === 'string') {
      return error;
    }
    if (error && error.message) {
      return error.message;
    }
    if (error && error.stack) {
      return error.stack.split('\n')[0];
    }
    return String(error);
  }

  private async generateReportFile(
    flakyTests: FlakyTestRecord[],
    flakyRate: number,
    testsWithRetries: number
  ): Promise<void> {
    const reportData: FlakyReportData = {
      generatedAt: new Date().toISOString(),
      totalTests: this.totalTests,
      flakyTests: flakyTests.sort((a, b) => b.retries - a.retries),
      summary: {
        totalFlaky: flakyTests.length,
        flakyRate,
        testsWithRetries,
      },
    };

    try {
      const dir = path.dirname(this.outputFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Write JSON report
      fs.writeFileSync(this.outputFile, JSON.stringify(reportData, null, 2));

      // Also generate markdown report
      const mdFile = this.outputFile.replace('.json', '.md');
      const mdContent = this.generateMarkdownReport(reportData);
      fs.writeFileSync(mdFile, mdContent);
    } catch (error) {
      console.error('Failed to write flaky test report:', error);
    }
  }

  private generateMarkdownReport(data: FlakyReportData): string {
    let md = '# Flaky E2E Test Report\n\n';
    md += `**Generated:** ${new Date(data.generatedAt).toLocaleString()}\n\n`;
    md += '## Summary\n\n';
    md += `- **Total Tests:** ${data.totalTests}\n`;
    md += `- **Tests with Retries:** ${data.summary.testsWithRetries}\n`;
    md += `- **Flaky Rate:** ${data.summary.flakyRate.toFixed(2)}%\n\n`;

    if (data.flakyTests.length > 0) {
      md += '## Flaky Tests\n\n';
      md += '| Test | File | Attempts | Passes | Failures | Retries | Status |\n';
      md += '|------|------|----------|--------|----------|---------|--------|\n';

      for (const test of data.flakyTests) {
        const statusEmoji = test.lastStatus === 'passed' ? '✅' : '❌';
        md += `| ${test.title} | ${test.file} | ${test.attempts} | ${test.passes} | ${test.failures} | ${test.retries} | ${statusEmoji} ${test.lastStatus} |\n`;
      }

      md += '\n## Detailed Information\n\n';

      for (const test of data.flakyTests) {
        md += `### ${test.title}\n\n`;
        md += `- **File:** \`${test.file}\`\n`;
        md += `- **Location:** \`${test.location}\`\n`;
        md += `- **Attempts:** ${test.attempts}\n`;
        md += `- **Passes:** ${test.passes}\n`;
        md += `- **Failures:** ${test.failures}\n`;
        md += `- **Retries:** ${test.retries}\n`;
        md += `- **Duration:** ${test.duration}ms\n`;
        md += `- **Last Status:** ${test.lastStatus}\n`;

        if (test.errors.length > 0) {
          md += `- **Errors:**\n`;
          for (const error of test.errors) {
            md += `  - ${error}\n`;
          }
        }

        md += '\n';
      }

      md += '## Recommendations\n\n';
      md += '1. **Review timing issues:** Check for race conditions and add appropriate waits\n';
      md += '2. **Improve test isolation:** Ensure tests don\'t depend on shared state\n';
      md += '3. **Add explicit waits:** Use `waitForSelector()`, `waitForLoadState()` instead of fixed timeouts\n';
      md += '4. **Mock external dependencies:** Avoid flakiness from network calls\n';
      md += '5. **Increase timeouts:** For genuinely slow operations, increase test timeouts\n';
    } else {
      md += '## ✅ No Flaky Tests Detected\n\n';
      md += 'All E2E tests passed on first attempt. Great job!\n';
    }

    return md;
  }
}
