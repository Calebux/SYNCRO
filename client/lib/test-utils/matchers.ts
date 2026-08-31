/**
 * Custom test matchers for domain-specific assertions
 * 
 * Extends Vitest's expect with custom matchers for common test scenarios.
 * These matchers provide more expressive and readable test assertions.
 * 
 * @example
 * expect(response).toHaveSuccessResponse({ id: '123' });
 * expect(response).toHaveErrorResponse('VALIDATION_ERROR');
 * expect(element).toBeAccessible();
 */

import { expect } from 'vitest';
import type { MatcherResult } from 'vitest';

/**
 * Standard API response structure
 */
interface ApiResponse {
  success: boolean;
  data?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Checks if a response has a successful API response structure
 * 
 * @example
 * expect(response).toHaveSuccessResponse();
 * expect(response).toHaveSuccessResponse({ id: '123', name: 'Test' });
 */
function toHaveSuccessResponse(
  received: Response | ApiResponse,
  expectedData?: unknown
): MatcherResult {
  let json: ApiResponse;
  
  // Handle Response object
  if (received instanceof Response) {
    try {
      json = received.json() as ApiResponse;
    } catch {
      return {
        pass: false,
        message: () => 'Expected response to be valid JSON',
        actual: received,
        expected: { success: true, data: expectedData },
      };
    }
  } else {
    json = received;
  }

  const hasSuccess = json.success === true;
  const hasExpectedData = expectedData 
    ? JSON.stringify(json.data) === JSON.stringify(expectedData)
    : true;

  const pass = hasSuccess && hasExpectedData;

  return {
    pass,
    message: () => {
      if (!hasSuccess) {
        return `Expected success response but got: ${JSON.stringify(json, null, 2)}`;
      }
      if (!hasExpectedData) {
        return `Expected data to match:\n${JSON.stringify(expectedData, null, 2)}\nBut got:\n${JSON.stringify(json.data, null, 2)}`;
      }
      return `Expected response not to be successful`;
    },
    actual: json,
    expected: { success: true, data: expectedData },
  };
}

/**
 * Checks if a response has an error response structure with specific error code
 * 
 * @example
 * expect(response).toHaveErrorResponse('VALIDATION_ERROR');
 * expect(response).toHaveErrorResponse('NOT_FOUND');
 */
function toHaveErrorResponse(
  received: Response | ApiResponse,
  expectedErrorCode?: string
): MatcherResult {
  let json: ApiResponse;
  
  // Handle Response object
  if (received instanceof Response) {
    try {
      json = received.json() as ApiResponse;
    } catch {
      return {
        pass: false,
        message: () => 'Expected response to be valid JSON',
        actual: received,
        expected: { success: false, error: { code: expectedErrorCode } },
      };
    }
  } else {
    json = received;
  }

  const hasError = json.success === false && json.error !== undefined;
  const hasExpectedCode = expectedErrorCode 
    ? json.error?.code === expectedErrorCode
    : true;

  const pass = hasError && hasExpectedCode;

  return {
    pass,
    message: () => {
      if (!hasError) {
        return `Expected error response but got: ${JSON.stringify(json, null, 2)}`;
      }
      if (!hasExpectedCode) {
        return `Expected error code "${expectedErrorCode}" but got "${json.error?.code}"`;
      }
      return `Expected response not to be an error`;
    },
    actual: json,
    expected: { success: false, error: { code: expectedErrorCode } },
  };
}

/**
 * Checks if an element meets basic accessibility requirements
 * 
 * Note: This is a simplified accessibility check. For comprehensive testing,
 * use @axe-core/react or similar tools.
 * 
 * @example
 * expect(element).toBeAccessible();
 */
function toBeAccessible(received: HTMLElement): MatcherResult {
  const violations: string[] = [];

  // Check for basic accessibility attributes
  if (received.tagName === 'BUTTON' && !received.hasAttribute('aria-label') && !received.textContent?.trim()) {
    violations.push('Button must have aria-label or text content');
  }

  if (received.tagName === 'IMG' && !received.hasAttribute('alt')) {
    violations.push('Image must have alt attribute');
  }

  if (received.tagName === 'INPUT' && !received.hasAttribute('aria-label') && !received.hasAttribute('id')) {
    violations.push('Input must have aria-label or associated label');
  }

  // Check for interactive elements with keyboard support
  const interactiveTags = ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'];
  if (interactiveTags.includes(received.tagName)) {
    const tabIndex = received.getAttribute('tabindex');
    if (tabIndex === '-1' && !received.hasAttribute('aria-hidden')) {
      violations.push('Interactive element should not have tabindex="-1" unless aria-hidden');
    }
  }

  // Check for proper heading hierarchy (simplified)
  if (received.tagName.match(/^H[1-6]$/)) {
    const level = parseInt(received.tagName[1]);
    const previousHeading = received.previousElementSibling?.tagName.match(/^H[1-6]$/);
    if (previousHeading) {
      const prevLevel = parseInt(previousHeading[1]);
      if (level > prevLevel + 1) {
        violations.push(`Heading level ${level} should not skip levels (previous was ${prevLevel})`);
      }
    }
  }

  const pass = violations.length === 0;

  return {
    pass,
    message: () => {
      if (!pass) {
        return `Element has accessibility violations:\n${violations.map(v => `  - ${v}`).join('\n')}`;
      }
      return 'Expected element to have accessibility violations';
    },
    actual: received,
    expected: 'accessible element',
  };
}

/**
 * Checks if a response matches a paginated response structure
 * 
 * @example
 * expect(response).toMatchPaginatedResponse();
 */
function toMatchPaginatedResponse(received: unknown): MatcherResult {
  const json = received as Record<string, unknown>;
  
  const hasData = Array.isArray(json.data);
  const hasPagination = typeof json.pagination === 'object' && json.pagination !== null;
  const hasTotal = typeof (json.pagination as Record<string, unknown>)?.total === 'number';
  const hasPage = typeof (json.pagination as Record<string, unknown>)?.page === 'number';
  const hasPageSize = typeof (json.pagination as Record<string, unknown>)?.pageSize === 'number';

  const pass = hasData && hasPagination && hasTotal && hasPage && hasPageSize;

  return {
    pass,
    message: () => {
      const missing: string[] = [];
      if (!hasData) missing.push('data array');
      if (!hasPagination) missing.push('pagination object');
      if (!hasTotal) missing.push('pagination.total');
      if (!hasPage) missing.push('pagination.page');
      if (!hasPageSize) missing.push('pagination.pageSize');

      if (!pass) {
        return `Expected paginated response structure but missing: ${missing.join(', ')}`;
      }
      return 'Expected response not to match paginated structure';
    },
    actual: json,
    expected: {
      data: expect.any(Array),
      pagination: {
        total: expect.any(Number),
        page: expect.any(Number),
        pageSize: expect.any(Number),
      },
    },
  };
}

/**
 * Checks if a response has a specific HTTP status code
 * 
 * @example
 * expect(response).toHaveStatus(200);
 * expect(response).toHaveStatus(404);
 */
function toHaveStatus(received: Response, expectedStatus: number): MatcherResult {
  const pass = received.status === expectedStatus;

  return {
    pass,
    message: () => {
      if (!pass) {
        return `Expected status ${expectedStatus} but got ${received.status}`;
      }
      return `Expected status not to be ${expectedStatus}`;
    },
    actual: received.status,
    expected: expectedStatus,
  };
}

// Register custom matchers
expect.extend({
  toHaveSuccessResponse,
  toHaveErrorResponse,
  toBeAccessible,
  toMatchPaginatedResponse,
  toHaveStatus,
});

// Type declarations for TypeScript
declare module 'vitest' {
  interface Assertion<T = unknown> {
    toHaveSuccessResponse(expectedData?: unknown): T;
    toHaveErrorResponse(expectedErrorCode?: string): T;
    toBeAccessible(): T;
    toMatchPaginatedResponse(): T;
    toHaveStatus(expectedStatus: number): T;
  }
  interface AsymmetricMatchersContaining {
    toHaveSuccessResponse(expectedData?: unknown): unknown;
    toHaveErrorResponse(expectedErrorCode?: string): unknown;
    toBeAccessible(): unknown;
    toMatchPaginatedResponse(): unknown;
    toHaveStatus(expectedStatus: number): unknown;
  }
}
