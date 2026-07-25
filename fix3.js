const fs = require('fs');
let c = fs.readFileSync('C:/Users/ADMIN/SYNCRO/backend/src/services/risk-detection/risk-detection-service.ts', 'utf8');

// Find the start of the broken section (the JSDoc comment that's inside code)
const badStart = c.indexOf('   * Recalculate risk for all active subscriptions.');
// Find the real end - everything after the orphaned code after the export line
const exportLine = 'export const riskDetectionService = new RiskDetectionService();\r\n';
const exportIdx = c.indexOf(exportLine);

// Cut: from badStart to end of file, replace with correct method + export
const goodMethod = `  /**
   * Recalculate risk for all active subscriptions.
   *
   * Each page of 100 subscriptions is processed concurrently up to
   * RISK_CALC_CONCURRENCY (default 10) simultaneous calculations,
   * giving ~10x throughput over the previous sequential approach.
   */
  async recalculateAllRiskScores(): Promise<{ total: number; successful: number; failed: number; errors: Array<{ subscription_id: string; error: string }> }> {
    const result = { total: 0, successful: 0, failed: 0, errors: [] as Array<{ subscription_id: string; error: string }> };
    const startTime = Date.now();
    const limit = pLimit(RISK_CALC_CONCURRENCY);
    try {
      logger.info("Starting risk recalculation for all active subscriptions", { concurrency: RISK_CALC_CONCURRENCY });
      let page = 0;
      const pageSize = 100;
      while (true) {
        const { data: subscriptions, error } = await supabase
          .from("subscriptions")
          .select("id, user_id")
          .eq("status", "active")
          .range(page * pageSize, (page + 1) * pageSize - 1);
        if (error) throw error;
        if (!subscriptions || subscriptions.length === 0) break;
        result.total += subscriptions.length;
        // Process the page concurrently, bounded by pLimit
        await Promise.all(
          subscriptions.map((subscription) =>
            limit(async () => {
              try {
                const assessment = await this.computeRiskLevel(subscription.id);
                await this.saveRiskScore(assessment, subscription.user_id);
                result.successful++;
              } catch (err) {
                result.failed++;
                result.errors.push({
                  subscription_id: subscription.id,
                  error: err instanceof Error ? err.message : String(err),
                });
                logger.error(
                  \`Failed to recalculate risk for subscription \${subscription.id}:\`,
                  err,
                );
              }
            }),
          ),
        );
        // Progress log every page (100 subscriptions)
        logger.info("Risk recalculation progress", {
          processed: result.total,
          successful: result.successful,
          failed: result.failed,
          elapsed_ms: Date.now() - startTime,
          concurrency: RISK_CALC_CONCURRENCY,
        });
        if (subscriptions.length < pageSize) break;
        page++;
      }
      return result;
    } catch (error) {
      logger.error("Error during risk recalculation:", error);
      throw error;
    }
  }
}

export const riskDetectionService = new RiskDetectionService();
`;

c = c.slice(0, badStart) + goodMethod;
fs.writeFileSync('C:/Users/ADMIN/SYNCRO/backend/src/services/risk-detection/risk-detection-service.ts', c, 'utf8');
console.log('risk-detection fixed, length:', c.length);
