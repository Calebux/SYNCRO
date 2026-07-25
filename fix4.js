const fs = require('fs');
let c = fs.readFileSync('C:/Users/ADMIN/SYNCRO/backend/src/services/risk-detection/risk-detection-service.ts', 'utf8');

const badStart = c.indexOf('          .catch((err) => {\r\n              \"Failed to dispatch subscription.risk_score_changed webhook:\",\r\n           err,\r\n          });\r\n');
const goodEnd = badStart + '          .catch((err) => {\r\n              \"Failed to dispatch subscription.risk_score_changed webhook:\",\r\n           err,\r\n          });\r\n'.length;

const fixedCatch = '          .catch((err) => {\r\n            logger.error("Failed to dispatch subscription.risk_score_changed webhook:", err);\r\n          });\r\n';

const goodMethod = `
  /**
   * Recalculate risk for all active subscriptions.
   */
  async recalculateAllRiskScores() {
    const result = { total: 0, successful: 0, failed: 0, errors: [] };
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
        await Promise.all(
          subscriptions.map((subscription) =>
            limit(async () => {
              try {
                const assessment = await this.computeRiskLevel(subscription.id);
                await this.saveRiskScore(assessment, subscription.user_id);
                result.successful++;
              } catch (err) {
                result.failed++;
                result.errors.push({ subscription_id: subscription.id, error: err instanceof Error ? err.message : String(err) });
                logger.error(\`Failed to recalculate risk for subscription \${subscription.id}:\`, err);
              }
            }),
          ),
        );
        logger.info("Risk recalculation progress", { processed: result.total, successful: result.successful, failed: result.failed, elapsed_ms: Date.now() - startTime });
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

c = c.slice(0, badStart) + fixedCatch + goodMethod;
fs.writeFileSync('C:/Users/ADMIN/SYNCRO/backend/src/services/risk-detection/risk-detection-service.ts', c, 'utf8');
console.log('done, length:', c.length);
