/**
 * Mathematical utilities for privacy and security.
 *
 * Layer 1 (logic): pure functions, no side effects.
 * Imports only from external libs and types/.
 */

/**
 * Generate Laplace noise for differential privacy.
 *
 * @param sensitivity The sensitivity parameter (Δf)
 * @param epsilon The privacy budget (ε)
 * @returns A sample from the Laplace distribution
 */
export function generateLaplaceNoise(sensitivity: number, epsilon: number): number {
  if (epsilon <= 0) {
    throw new RangeError('epsilon must be positive');
  }
  if (sensitivity < 0) {
    throw new RangeError('sensitivity must be non-negative');
  }

  const scale = sensitivity / epsilon;
  const u = Math.random() - 0.5;
  return -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
}

/**
 * Add differential privacy noise to a numeric value.
 *
 * @param value The true value
 * @param sensitivity The sensitivity parameter
 * @param epsilon The privacy budget
 * @returns The noised value
 */
export function addDifferentialPrivacyNoise(
  value: number,
  sensitivity: number,
  epsilon: number,
): number {
  return value + generateLaplaceNoise(sensitivity, epsilon);
}
