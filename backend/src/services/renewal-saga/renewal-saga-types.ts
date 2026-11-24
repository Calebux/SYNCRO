export type RenewalSagaStepName =
  | 'reserve'
  | 'authorize_on_chain'
  | 'charge'
  | 'record'
  | 'notify'
  | 'release';

/** Forward execution order. Compensation runs this reversed. */
export const RENEWAL_SAGA_STEPS: RenewalSagaStepName[] = [
  'reserve',
  'authorize_on_chain',
  'charge',
  'record',
  'notify',
  'release',
];

export type RenewalSagaStatus =
  | 'pending'
  | 'running'
  | 'compensating'
  | 'completed'
  | 'compensated'
  | 'dead_lettered';

/**
 * Everything a step needs to execute or compensate. `data` accumulates
 * step outputs (e.g. which charge method was used, prior subscription
 * snapshot) so later steps and compensations can read them.
 */
export interface RenewalSagaContext {
  attemptId: string;
  idempotencyKey: string;
  subscriptionId: string;
  userId: string;
  approvalId: string;
  amount: number;
  cycleId: number;
  lockHolder: string;
  data: Record<string, unknown>;
}

export interface RenewalSagaStepResult {
  /** Output to persist and hand to later steps / compensation. */
  output?: Record<string, unknown>;
}

export interface RenewalSagaStep {
  name: RenewalSagaStepName;
  /** Must be safe to call more than once for the same attemptId. */
  execute(ctx: RenewalSagaContext): Promise<RenewalSagaStepResult | void>;
  /** Must be safe to call more than once for the same attemptId. */
  compensate(ctx: RenewalSagaContext): Promise<void>;
}

export interface RenewalSagaState {
  attemptId: string;
  idempotencyKey: string;
  subscriptionId: string;
  userId: string;
  cycleId: number;
  sagaStatus: RenewalSagaStatus;
  currentStep: RenewalSagaStepName | null;
  completedSteps: RenewalSagaStepName[];
  stepContext: Record<string, unknown>;
  stepStartedAt: string | null;
  workerId: string | null;
  needsManualReconciliation: boolean;
  updatedAt: string;
}

export interface RenewalSagaOutcome {
  success: boolean;
  attemptId: string;
  sagaStatus: RenewalSagaStatus;
  transactionHash?: string;
  error?: string;
  failureReason?: string;
}