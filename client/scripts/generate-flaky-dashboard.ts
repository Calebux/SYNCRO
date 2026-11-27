/**
 * Generate Flaky Test Dashboard
 * 
 * Generates an HTML dashboard showing flaky test trends over time.
 * Reads historical data from test runs and visualizes flake patterns.
 * 
 * **Validates: Requirements 6.5, 6.6**
 */

import fs from 'fs';
import path from 'path';
import { FlakyTestDetector } from '../lib/test-utils/flaky-detector';

interface DashboardData {
  generatedAt: string;
  stats: {
    totalTests: number;
    flakyTests: number;
    stabilizedTests: number;
    averageFlakeRate: number;
  };
  flakyTests: Array<{
    testName: string;
    testFile: string;
    flakeRate: number;
    totalRuns: number;
    failures: number;
    lastFailure?: string;
    status: string;
  }>;
  trends: {
    dates: string[];
    flakyCount: number[];
    stabilizedCount: number[];
  };
}

function generateHTML(data: DashboardData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Flaky Test Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: #f5f5f5;
      padding: 20px;
      color: #333;
    }
    
    .container {
      max-width: 1400px;
      margin: 0 auto;
      background: white;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      padding: 30px;
    }
    
    header {
      border-bottom: 2px solid #e5e5e5;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    
    h1 {
      font-size: 32px;
      color: #1a1a1a;
      margin-bottom: 8px;
    }
    
    .timestamp {
      color: #666;
      font-size: 14px;
    }
    
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      margin-bottom: 40px;
    }
    
    .stat-card {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 24px;
      border-radius: 10px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    }
    
    .stat-card.warning {
      background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
    }
    
    .stat-card.success {
      background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
    }
    
    .stat-card.info {
      background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);
    }
    
    .stat-label {
      font-size: 14px;
      opacity: 0.9;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .stat-value {
      font-size: 36px;
      font-weight: bold;
      line-height: 1;
    }
    
    .chart-container {
      margin-bottom: 40px;
      padding: 20px;
      background: #fafafa;
      border-radius: 8px;
    }
    
    .chart-title {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 16px;
      color: #1a1a1a;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 20px;
    }
    
    th {
      background: #f5f5f5;
      padding: 12px;
      text-align: left;
      font-weight: 600;
      color: #666;
      border-bottom: 2px solid #e5e5e5;
      font-size: 14px;
    }
    
    td {
      padding: 12px;
      border-bottom: 1px solid #e5e5e5;
    }
    
    tr:hover {
      background: #fafafa;
    }
    
    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
    }
    
    .badge-flaky {
      background: #fee;
      color: #c00;
    }
    
    .badge-stable {
      background: #efe;
      color: #0a0;
    }
    
    .flake-rate {
      font-weight: 600;
    }
    
    .flake-rate.high {
      color: #e53e3e;
    }
    
    .flake-rate.medium {
      color: #ed8936;
    }
    
    .flake-rate.low {
      color: #48bb78;
    }
    
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #666;
    }
    
    .empty-state-icon {
      font-size: 64px;
      margin-bottom: 16px;
    }
    
    .empty-state-title {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 8px;
      color: #1a1a1a;
    }
    
    .empty-state-text {
      font-size: 16px;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🔍 Flaky Test Dashboard</h1>
      <p class="timestamp">Generated: ${new Date(data.generatedAt).toLocaleString()}</p>
    </header>
    
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Total Tests</div>
        <div class="stat-value">${data.stats.totalTests}</div>
      </div>
      
      <div class="stat-card warning">
        <div class="stat-label">Flaky Tests</div>
        <div class="stat-value">${data.stats.flakyTests}</div>
      </div>
      
      <div class="stat-card success">
        <div class="stat-label">Stabilized Tests</div>
        <div class="stat-value">${data.stats.stabilizedTests}</div>
      </div>
      
      <div class="stat-card info">
        <div class="stat-label">Average Flake Rate</div>
        <div class="stat-value">${(data.stats.averageFlakeRate * 100).toFixed(1)}%</div>
      </div>
    </div>
    
    ${data.trends.dates.length > 0 ? `
    <div class="chart-container">
      <h2 class="chart-title">Flaky Test Trends</h2>
      <canvas id="trendChart" height="80"></canvas>
    </div>
    ` : ''}
    
    ${data.flakyTests.length > 0 ? `
    <div>
      <h2 class="chart-title">Current Flaky Tests</h2>
      <table>
        <thead>
          <tr>
            <th>Test Name</th>
            <th>File</th>
            <th>Flake Rate</th>
            <th>Total Runs</th>
            <th>Failures</th>
            <th>Last Failure</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${data.flakyTests.map(test => {
            const flakeRateClass = test.flakeRate > 0.5 ? 'high' : test.flakeRate > 0.3 ? 'medium' : 'low';
            const lastFailure = test.lastFailure 
              ? new Date(test.lastFailure).toLocaleString()
              : 'Never';
            
            return `
            <tr>
              <td><strong>${test.testName}</strong></td>
              <td><code>${test.testFile}</code></td>
              <td><span class="flake-rate ${flakeRateClass}">${(test.flakeRate * 100).toFixed(1)}%</span></td>
              <td>${test.totalRuns}</td>
              <td>${test.failures}</td>
              <td>${lastFailure}</td>
              <td><span class="badge badge-${test.status}">${test.status.toUpperCase()}</span></td>
            </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
    ` : `
    <div class="empty-state">
      <div class="empty-state-icon">✅</div>
      <div class="empty-state-title">No Flaky Tests Detected!</div>
      <p class="empty-state-text">All tests are passing consistently. Keep up the great work!</p>
    </div>
    `}
  </div>
  
  ${data.trends.dates.length > 0 ? `
  <script>
    const ctx = document.getElementById('trendChart').getContext('2d');
    new Chart(ctx, {
      type: 'line',
      data: {
        labels: ${JSON.stringify(data.trends.dates)},
        datasets: [
          {
            label: 'Flaky Tests',
            data: ${JSON.stringify(data.trends.flakyCount)},
            borderColor: '#e53e3e',
            backgroundColor: 'rgba(229, 62, 62, 0.1)',
            tension: 0.4,
          },
          {
            label: 'Stabilized Tests',
            data: ${JSON.stringify(data.trends.stabilizedCount)},
            borderColor: '#48bb78',
            backgroundColor: 'rgba(72, 187, 120, 0.1)',
            tension: 0.4,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            position: 'top',
          },
          title: {
            display: false,
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              stepSize: 1
            }
          }
        }
      }
    });
  </script>
  ` : ''}
</body>
</html>`;
}

async function main() {
  const detector = new FlakyTestDetector();
  const stats = detector.getStats();
  const flakyTests = detector.getAllFlakyTests();

  const dashboardData: DashboardData = {
    generatedAt: new Date().toISOString(),
    stats,
    flakyTests: flakyTests.map(test => ({
      testName: test.testName,
      testFile: test.testFile,
      flakeRate: test.flakeRate,
      totalRuns: test.totalRuns,
      failures: test.failures,
      lastFailure: test.lastFailure,
      status: test.status,
    })),
    trends: {
      dates: [],
      flakyCount: [],
      stabilizedCount: [],
    },
  };

  // Generate HTML dashboard
  const html = generateHTML(dashboardData);
  const outputPath = path.join(process.cwd(), 'test-results', 'flaky-dashboard.html');

  // Ensure directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, html);

  console.log(`\n✅ Flaky test dashboard generated: ${outputPath}`);
  console.log(`📊 Summary:`);
  console.log(`   Total Tests: ${stats.totalTests}`);
  console.log(`   Flaky Tests: ${stats.flakyTests}`);
  console.log(`   Stabilized Tests: ${stats.stabilizedTests}`);
  console.log(`   Average Flake Rate: ${(stats.averageFlakeRate * 100).toFixed(2)}%\n`);
}

main().catch(console.error);
