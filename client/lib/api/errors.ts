/**
 * Centralized Error Handling
 * Provides standardized error creation and handling for API routes
 */

import { NextResponse } from 'next/server'
import { ErrorCode, HttpStatus, type ApiError, type ApiResponse } from './types'
import { ZodError } from 'zod'

/**
 * Custom API Error Class
 */
export class ApiException extends Error {
  public headers?: Record<string, string>

  constructor(
    public code: ErrorCode,
    public message: string,
    public statusCode: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR,
    public details?: Record<string, unknown>,
    public field?: string
  ) {
    super(message)
    this.name = 'ApiException'
  }

  toApiError(): ApiError {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      field: this.field,
    }
  }
}

/**
 * Predefined Error Factories
 */
export const ApiErrors = {
  unauthorized: (message = 'Authentication required') =>
    new ApiException(ErrorCode.UNAUTHORIZED, message, HttpStatus.UNAUTHORIZED),

  forbidden: (message = 'Insufficient permissions') =>
    new ApiException(ErrorCode.FORBIDDEN, message, HttpStatus.FORBIDDEN),

  notFound: (resource = 'Resource', message?: string) =>
    new ApiException(
      ErrorCode.NOT_FOUND,
      message || `${resource} not found`,
      HttpStatus.NOT_FOUND
    ),

  validationError: (message: string, field?: string, details?: Record<string, unknown>) =>
    new ApiException(
      ErrorCode.VALIDATION_ERROR,
      message,
      HttpStatus.BAD_REQUEST,
      details,
      field
    ),

  conflict: (message = 'Resource conflict') =>
    new ApiException(ErrorCode.CONFLICT, message, HttpStatus.CONFLICT),

  rateLimitExceeded: (message = 'Rate limit exceeded') =>
    new ApiException(
      ErrorCode.RATE_LIMIT_EXCEEDED,
      message,
      HttpStatus.TOO_MANY_REQUESTS
    ),

  internalError: (message = 'Internal server error', details?: Record<string, unknown>) =>
    new ApiException(
      ErrorCode.INTERNAL_ERROR,
      message,
      HttpStatus.INTERNAL_SERVER_ERROR,
      details
    ),

  serviceUnavailable: (message = 'Service temporarily unavailable') =>
    new ApiException(
      ErrorCode.SERVICE_UNAVAILABLE,
      message,
      HttpStatus.SERVICE_UNAVAILABLE
    ),
}

/**
 * Convert Zod validation errors to API errors
 */
export function zodErrorToApiError(error: ZodError): ApiException {
  const issues = error.issues
  const firstError = issues[0]
  const field = firstError?.path.join('.')
  const message = firstError?.message || 'Validation failed'

  return ApiErrors.validationError(message, field, {
    errors: issues.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
      code: e.code,
    })),
  })
}

/**
 * Create standardized error response
 */
export function createErrorResponse(
  error: unknown,
  requestId?: string
): NextResponse<ApiResponse> {
  // Handle known API exceptions
  if (error instanceof ApiException) {
    return NextResponse.json(
      {
        success: false,
        error: error.toApiError(),
        meta: {
          timestamp: new Date().toISOString(),
          requestId,
        },
      },
      {
        status: error.statusCode,
        headers: error.headers,
      },
    )
  }

  // Handle Zod validation errors
  if (error instanceof ZodError) {
    const apiError = zodErrorToApiError(error)
    return NextResponse.json(
      {
        success: false,
        error: apiError.toApiError(),
        meta: {
          timestamp: new Date().toISOString(),
          requestId,
        },
      },
      { status: apiError.statusCode }
    )
  }

  // Handle unknown errors
  const message = error instanceof Error ? error.message : 'An unexpected error occurred'
  const apiError = ApiErrors.internalError(message)

  // Log full error in development
  if (process.env.NODE_ENV === 'development') {
    console.error('Unhandled error:', error)
  }

  return NextResponse.json(
    {
      success: false,
      error: apiError.toApiError(),
      meta: {
        timestamp: new Date().toISOString(),
        requestId,
      },
    },
    { status: apiError.statusCode }
  )
}

/**
 * Create standardized success response
 */
export function createSuccessResponse<T>(
  data: T,
  status: HttpStatus = HttpStatus.OK,
  requestId?: string,
  meta?: Record<string, unknown>
): NextResponse<ApiResponse<T>> {
  return NextResponse.json(
    {
      success: true,
      data,
      meta: {
        timestamp: new Date().toISOString(),
        requestId,
        ...meta,
      },
    },
    { status }
  )
}

/**
 * Async error handler wrapper for API routes
 */
export function withErrorHandling<T extends unknown[]>(
  handler: (...args: T) => Promise<NextResponse<ApiResponse>>,
  requestId?: string
) {
  return async (...args: T): Promise<NextResponse<ApiResponse>> => {
    try {
      return await handler(...args)
    } catch (error) {
      return createErrorResponse(error, requestId)
    }
  }
}
