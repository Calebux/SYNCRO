/**
 * Vitest Custom Reporter for Flaky Test Detection
 * 
 * Integrates flaky test detection with Vitest unit tests.
 * Tracks test results and identifies tests that fail inconsistently.
 */

import type { Reporter } from 'vitest';
import { FlakyTestDetector } from './flaky-detector';

export default class VitestFlakyReporter implements Reporter {
  private detector: FlakyTestDetector;

  constructor() {
    this.detector = new FlakyTestDetector();
  }

  onInit() {
    // Reporter initialized
  }

  onFinished(files: any[], errors?: unknown[]) {
    // Process test results
    if (files) {
      files.forEach(file => {
        this.processTestFile(file);
      });
    }

    // Generate report
    const stats = this.detector.getStats();
    const flakyTests = this.detector.getAllFlakyTests();

    if (flakyTests.length > 0) {
      console.log('\n⚠️  Flaky Tests Detected:');
      flakyTests.forEach(test => {
        console.log(`  • ${test.testName}`);
        console.log(`    Flake Rate: ${(test.flakeRate * 100).toFixed(2)}%`);
        console.log(`    Total Runs: ${test.totalRuns}, Failures: ${test.failures}`);
      });
    }

    // Save report to file
    const report = this.detector.generateReport();
    const fs = require('fs');
    const path = require('path');
    const reportPath = path.join(process.cwd(), 'test-results', 'flaky-tests-unit.md');
    
    const dir = path.dirname(reportPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(reportPath, report);
  }

  private processTestFile(file: any) {
    if (!file.tasks) return;

    file.tasks.forEach((task: any) => {
      this.processTask(task, file.filepath);
    });
  }

  private processTask(task: any, filepath: string) {
    if (task.type === 'test') {
      this.detector.recordResult({
        testName: task.name,
        testFile: filepath,
        passed: task.result?.state === 'pass',
        timestamp: new Date().toISOString(),
        duration: task.result?.duration || 0,
        error: task.result?.error?.message,
      });
    }

    // Process nested tasks (describe blocks)
    if (task.tasks) {
      task.tasks.forEach((nestedTask: any) => {
        this.processTask(nestedTask, filepath);
      });
    }
  }
}
