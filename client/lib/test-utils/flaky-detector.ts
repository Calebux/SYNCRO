/**
 * Flaky Test Detector
 * 
 * Tracks test execution results to identify flaky tests (tests that intermittently
 * pass/fail without code changes). A test is flagged as flaky if it flakes more
 * than 30% of the time in the last 10 runs.
 * 
 * **Validates: Requirements 6.1, 6.2, 6.3**
 */

import fs from 'fs';
import path from 'path';

export interface TestResult {
  testName: string;
  testFile: string;
  passed: boolean;
  timestamp: string;
  duration: number;
  error?: string;
}

export interface FlakyTestInfo {
  testName: string;
  testFile: string;
  flakeRate: number;
  totalRuns: number;
  failures: number;
  lastFailure?: string;
  flaggedAt: string;
  status: 'flaky' | 'stable';
}

export interface TestHistory {
  [testKey: string]: TestResult[];
}

export class FlakyTestDetector {
  private historyFile: string;
  private history: TestHistory;
  private readonly maxHistoryPerTest = 10;
  private readonly flakyThreshold = 0.3; // 30%
  private readonly stabilizationThreshold = 20; // 20 consecutive passes

  constructor(historyFilePath?: string) {
    this.historyFile = historyFilePath || path.join(process.cwd(), '.test-history.json');
    this.history = this.loadHistory();
  }

  /**
   * Load test history from file
   */
  private loadHistory(): TestHistory {
    try {
      if (fs.existsSync(this.historyFile)) {
        const data = fs.readFileSync(this.historyFile, 'utf-8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.warn('Failed to load test history:', error);
    }
    return {};
  }

  /**
   * Save test history to file
   */
  private saveHistory(): void {
    try {
      const dir = path.dirname(this.historyFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.historyFile, JSON.stringify(this.history, null, 2));
    } catch (error) {
      console.error('Failed to save test history:', error);
    }
  }

  /**
   * Generate a unique key for a test
   */
  private getTestKey(testFile: string, testName: string): string {
    return `${testFile}::${testName}`;
  }

  /**
   * Record a test result
   */
  recordResult(result: TestResult): void {
    const key = this.getTestKey(result.testFile, result.testName);

    if (!this.history[key]) {
      this.history[key] = [];
    }

    // Add new result
    this.history[key].push(result);

    // Keep only last N results
    if (this.history[key].length > this.maxHistoryPerTest) {
      this.history[key] = this.history[key].slice(-this.maxHistoryPerTest);
    }

    this.saveHistory();
  }

  /**
   * Calculate flake rate for a test
   */
  calculateFlakeRate(testFile: string, testName: string): number {
    const key = this.getTestKey(testFile, testName);
    const results = this.history[key] || [];

    if (results.length < 2) {
      return 0;
    }

    let flakeCount = 0;
    for (let i = 1; i < results.length; i++) {
      if (results[i].passed !== results[i - 1].passed) {
        flakeCount++;
      }
    }

    return flakeCount / (results.length - 1);
  }

  /**
   * Check if a test is flaky
   */
  isFlaky(testFile: string, testName: string): boolean {
    const key = this.getTestKey(testFile, testName);
    const results = this.history[key] || [];

    if (results.length < this.maxHistoryPerTest) {
      return false; // Not enough data
    }

    const flakeRate = this.calculateFlakeRate(testFile, testName);
    return flakeRate > this.flakyThreshold;
  }

  /**
   * Check if a flaky test has been stabilized
   */
  isStabilized(testFile: string, testName: string): boolean {
    const key = this.getTestKey(testFile, testName);
    const results = this.history[key] || [];

    if (results.length < this.stabilizationThreshold) {
      return false;
    }

    // Check last N runs are all passes
    const recentRuns = results.slice(-this.stabilizationThreshold);
    return recentRuns.every(result => result.passed);
  }

  /**
   * Get flaky test information
   */
  getFlakyTestInfo(testFile: string, testName: string): FlakyTestInfo | null {
    const key = this.getTestKey(testFile, testName);
    const results = this.history[key] || [];

    if (results.length === 0) {
      return null;
    }

    const failures = results.filter(r => !r.passed).length;
    const flakeRate = this.calculateFlakeRate(testFile, testName);
    const lastFailure = results.reverse().find(r => !r.passed);

    // Determine status
    let status: 'flaky' | 'stable' = 'stable';
    if (this.isFlaky(testFile, testName)) {
      status = this.isStabilized(testFile, testName) ? 'stable' : 'flaky';
    }

    return {
      testName,
      testFile,
      flakeRate,
      totalRuns: results.length,
      failures,
      lastFailure: lastFailure?.timestamp,
      flaggedAt: results[0].timestamp,
      status,
    };
  }

  /**
   * Get all flaky tests
   */
  getAllFlakyTests(): FlakyTestInfo[] {
    const flakyTests: FlakyTestInfo[] = [];

    for (const key in this.history) {
      const [testFile, testName] = key.split('::');
      if (this.isFlaky(testFile, testName) && !this.isStabilized(testFile, testName)) {
        const info = this.getFlakyTestInfo(testFile, testName);
        if (info) {
          flakyTests.push(info);
        }
      }
    }

    return flakyTests.sort((a, b) => b.flakeRate - a.flakeRate);
  }

  /**
   * Get test statistics
   */
  getStats(): {
    totalTests: number;
    flakyTests: number;
    stabilizedTests: number;
    averageFlakeRate: number;
  } {
    const allTests = Object.keys(this.history);
    const flakyTests = allTests.filter(key => {
      const [testFile, testName] = key.split('::');
      return this.isFlaky(testFile, testName) && !this.isStabilized(testFile, testName);
    });

    const stabilizedTests = allTests.filter(key => {
      const [testFile, testName] = key.split('::');
      return this.isFlaky(testFile, testName) && this.isStabilized(testFile, testName);
    });

    const flakeRates = allTests.map(key => {
      const [testFile, testName] = key.split('::');
      return this.calculateFlakeRate(testFile, testName);
    });

    const averageFlakeRate = flakeRates.length > 0
      ? flakeRates.reduce((sum, rate) => sum + rate, 0) / flakeRates.length
      : 0;

    return {
      totalTests: allTests.length,
      flakyTests: flakyTests.length,
      stabilizedTests: stabilizedTests.length,
      averageFlakeRate,
    };
  }

  /**
   * Generate a flaky test report
   */
  generateReport(): string {
    const stats = this.getStats();
    const flakyTests = this.getAllFlakyTests();

    let report = '# Flaky Test Report\n\n';
    report += `Generated: ${new Date().toISOString()}\n\n`;
    report += '## Summary\n\n';
    report += `- Total Tests Tracked: ${stats.totalTests}\n`;
    report += `- Flaky Tests: ${stats.flakyTests}\n`;
    report += `- Stabilized Tests: ${stats.stabilizedTests}\n`;
    report += `- Average Flake Rate: ${(stats.averageFlakeRate * 100).toFixed(2)}%\n\n`;

    if (flakyTests.length > 0) {
      report += '## Flaky Tests\n\n';
      report += '| Test | File | Flake Rate | Total Runs | Failures | Last Failure |\n';
      report += '|------|------|------------|------------|----------|-------------|\n';

      for (const test of flakyTests) {
        const flakeRatePercent = (test.flakeRate * 100).toFixed(2);
        const lastFailure = test.lastFailure
          ? new Date(test.lastFailure).toLocaleString()
          : 'N/A';

        report += `| ${test.testName} | ${test.testFile} | ${flakeRatePercent}% | ${test.totalRuns} | ${test.failures} | ${lastFailure} |\n`;
      }

      report += '\n## Recommendations\n\n';
      report += '1. **Investigate root causes**: Look for timing issues, race conditions, or external dependencies\n';
      report += '2. **Add proper waits**: Use `waitFor` instead of arbitrary timeouts\n';
      report += '3. **Mock external dependencies**: Ensure tests are isolated from network calls or file system\n';
      report += '4. **Fix or quarantine**: Either fix the flaky tests or mark them as skipped until fixed\n';
    } else {
      report += '## ✅ No flaky tests detected!\n\n';
      report += 'All tests are passing consistently.\n';
    }

    return report;
  }

  /**
   * Clear history for a specific test
   */
  clearTestHistory(testFile: string, testName: string): void {
    const key = this.getTestKey(testFile, testName);
    delete this.history[key];
    this.saveHistory();
  }

  /**
   * Clear all history
   */
  clearAllHistory(): void {
    this.history = {};
    this.saveHistory();
  }
}

export default FlakyTestDetector;
