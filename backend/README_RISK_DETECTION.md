# Risk Detection System
#

This document describes the Risk Detection System implementation for subscription management.

## Overview

The Risk Detection System proactively monitors subscription health and computes risk levels to prevent payment failures. The system evaluates multiple risk factors and assigns categorical risk levels (LOW, MEDIUM, HIGH) to each subscription.

## Features

- **Automated Risk Assessment**: Daily recalculation of risk scores for all active subscriptions
- **Multiple Risk Factors**: Evaluates consecutive failures, balance projections, and approval expiration
- **Proactive Notifications**: Alerts users when subscriptions reach HIGH risk
- **RESTful API**: Access risk scores via authenticated endpoints
- **Configurable Weights**: Customize risk factor weights via environment variables
- **Graceful Degradation**: Continues operation even when some risk factors fail to evaluate

## Architecture

### Components

1. **RiskDetectionService** (`src/services/risk-detection/risk-detection-service.ts`)
   - Core service for computing and managing risk scores
   - Orchestrates evaluators and aggregation
   - Handles batch recalculation

2. **Risk Factor Evaluators** (`src/services/risk-detection/evaluators/`)
   - **ConsecutiveFailuresEvaluator**: Tracks failed renewal attempts
   - **BalanceProjectionEvaluator**: Assesses account balance sufficiency
   - **ApprovalExpirationEvaluator**: Checks approval expiration status

3. **RiskAggregator** (`src/services/risk-detection/risk-aggregator.ts`)
   - Combines individual risk factors into overall risk level
   - Uses max weight strategy

4. **RiskNotificationService** (`src/services/risk-detection/risk-notification-service.ts`)
   - Handles notifications for risk level changes
   - Implements deduplication logic

5. **API Routes** (`src/routes/risk-score.ts`)
   - RESTful endpoints for accessing risk scores
   - Authentication and authorization

## Database Schema

### subscription_risk_scores
Stores computed risk levels:
- `id`: UUID primary key
- `subscription_id`: Reference to subscription (unique)
- `user_id`: Reference to user
- `risk_level`: LOW, MEDIUM, or HIGH
- `risk_factors`: JSONB array of risk factors
- `last_calculated_at`: Timestamp of last calculation
- `last_notified_risk_level`: Last notified level (for deduplication)

### subscription_renewal_attempts
Tracks renewal payment attempts:
- `id`: UUID primary key
- `subscription_id`: Reference to subscription
- `attempt_date`: Timestamp of attempt
- `success`: Boolean indicating success/failure
- `error_message`: Error details if failed

### subscription_approvals
Manages approval requirements:
- `id`: UUID primary key
- `subscription_id`: Reference to subscription
- `user_id`: Reference to user
- `approval_type`: renewal or payment
- `expires_at`: Expiration timestamp
- `status`: active, expired, or revoked

## Risk Calculation Logic

### Risk Factors

1. **Consecutive Failures**
   - 0 failures: NONE weight (0)
   - 1-2 failures: MEDIUM weight (5)
   - 3+ failures: HIGH weight (10)

2. **Balance Projection**
   - Balance >= 120% of renewal amount: NONE weight (0)
   - Balance 100-120% of renewal amount: MEDIUM weight (5)
   - Balance < 100% of renewal amount: HIGH weight (10)

3. **Approval Expiration**
   - Valid approval: NONE weight (0)
   - Expired or missing approval: HIGH weight (10)

### Aggregation Rules

Risk level is determined by the highest weight:
- **HIGH**: Any factor with weight >= 10
- **MEDIUM**: Any factor with weight >= 5 and < 10
- **LOW**: All factors with weight < 5

## API Endpoints

### GET /api/risk-score/:subscriptionId
Get risk score for a specific subscription.

**Authentication**: Required

**Response**:
```json
{
  "success": true,
  "data": {
    "subscription_id": "uuid",
    "risk_level": "HIGH",
    "risk_factors": [
      {
        "factor_type": "consecutive_failures",
        "weight": "HIGH",
        "details": {
          "consecutive_failures": 3,
          "total_attempts": 5
        }
      }
    ],
    "last_calculated_at": "2024-01-15T10:30:00Z"
  }
}
```

### GET /api/risk-score
Get all risk scores for authenticated user.

**Authentication**: Required

**Response**:
```json
{
  "success": true,
  "data": [...],
  "total": 5
}
```

### POST /api/risk-score/:subscriptionId/calculate
Manually trigger risk calculation for a subscription.

**Authentication**: Required

### POST /api/risk-score/recalculate
Manually trigger risk recalculation for all subscriptions.

**Authentication**: Required (Admin recommended)

## Configuration

### Environment Variables

Configure risk factor weights via environment variables:

```bash
# Consecutive Failures Weights
RISK_WEIGHT_CONSECUTIVE_NONE=0
RISK_WEIGHT_CONSECUTIVE_MEDIUM=5
RISK_WEIGHT_CONSECUTIVE_HIGH=10

# Balance Projection Weights
RISK_WEIGHT_BALANCE_SUFFICIENT=0
RISK_WEIGHT_BALANCE_LOW=5
RISK_WEIGHT_BALANCE_INSUFFICIENT=10

# Approval Expiration Weights
RISK_WEIGHT_APPROVAL_VALID=0
RISK_WEIGHT_APPROVAL_EXPIRED=10
```

## Scheduled Jobs

The system runs automated jobs via the scheduler:

- **Daily at 2 AM UTC**: Risk recalculation for all active subscriptions
- Processes subscriptions in batches of 100
- Logs success/failure counts and duration

## Notifications

The system triggers notifications when:
- A subscription transitions to HIGH risk
- A subscription transitions from HIGH to lower risk

Notifications include:
- Subscription details (name, price)
- Previous and new risk levels
- Specific risk factors contributing to the level

## Setup

### 1. Database Migration

Run the migration script:
```bash
# Execute backend/scripts/010_create_risk_detection_tables.sql
```

### 2. Environment Variables

Add risk weight configuration to `.env` (optional, defaults provided).

### 3. Start Server

The risk detection system starts automatically with the server:
```bash
npm run dev
```

## Usage Examples

### Record a Renewal Attempt

```typescript
import { riskDetectionService } from './services/risk-detection/risk-detection-service';

// Record failed attempt
await riskDetectionService.recordRenewalAttempt(
  subscriptionId,
  false,
  'Insufficient funds'
);

// Record successful attempt
await riskDetectionService.recordRenewalAttempt(
  subscriptionId,
  true
);
```

### Compute Risk for a Subscription

```typescript
const assessment = await riskDetectionService.computeRiskLevel(subscriptionId);
console.log(assessment.risk_level); // 'LOW', 'MEDIUM', or 'HIGH'
```

### Get User Risk Scores

```typescript
const scores = await riskDetectionService.getUserRiskScores(userId);
scores.forEach(score => {
  console.log(`${score.subscription_id}: ${score.risk_level}`);
});
```

## Monitoring

### Logs

The system logs:
- Each risk calculation with subscription ID and result
- Batch recalculation start/end with counts
- Errors with full context
- Notification triggers

### Metrics

Track these metrics:
- Calculation duration per subscription (target: <100ms)
- Batch recalculation duration (target: <5min for 10k subscriptions)
- API response time (target: <200ms)
- Error rate (target: <1%)

## Error Handling

### Graceful Degradation

If a risk factor evaluator fails:
- Returns NONE weight (0)
- Logs error
- Continues with other factors

### Batch Processing

If individual subscriptions fail during batch recalculation:
- Logs error with subscription ID
- Continues processing other subscriptions
- Returns summary with success/failure counts

### Default Behavior

On calculation error:
- Assigns LOW risk (safe default)
- Logs error for investigation
- Schedules retry on next recalculation

## Testing

### Manual Testing

```bash
# Trigger manual recalculation
curl -X POST http://localhost:3001/api/risk-score/recalculate \
  -H "Authorization: Bearer YOUR_TOKEN"

# Get risk score
curl http://localhost:3001/api/risk-score/SUBSCRIPTION_ID \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Future Enhancements

- [ ] Machine learning-based risk prediction
- [ ] Real-time risk calculation on subscription changes
- [ ] Custom risk factors per user
- [ ] Risk trend analysis and reporting
- [ ] Predictive alerts before risk increases
- [ ] Risk mitigation recommendations
- [ ] Integration with payment retry logic

## Troubleshooting

### Risk scores not updating

1. Check scheduler is running: `GET /api/reminders/status`
2. Check logs for errors during recalculation
3. Verify database connectivity
4. Manually trigger recalculation

### Incorrect risk levels

1. Verify risk weight configuration
2. Check renewal attempt records
3. Review risk factor details in risk_factors JSONB
4. Check evaluator logs for errors

### Missing notifications

1. Verify notification service integration
2. Check last_notified_risk_level for deduplication
3. Review notification service logs
4. Ensure risk level actually changed

## Support

For issues or questions:
1. Check logs in `error.log` and `combined.log`
2. Review database records in risk-related tables
3. Test individual components (evaluators, aggregator)
4. Contact development team with error details
