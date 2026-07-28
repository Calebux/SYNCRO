import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors';
import logger from '../config/logger';

/**
 * Maps Zod errors to a structured format for the response.
 */
const mapZodError = (error: ZodError) => {
  return error.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
  }));
};

/**
 * Global error handler middleware following RFC 7807 Problem Details.
 * On failure a **400 Bad Request** response is returned using the
 * RFC 9457 Problem Details format.
 */
export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
) => {
  const requestId = (res.getHeader('x-request-id') || req.headers['x-request-id']) as string;
  const instance = req.path;

  // Handle Zod Validation Errors
  if (err instanceof ZodError) {
    return res
      .status(400)
      .type('application/problem+json')
      .json({
        type: 'https://syncro.app/errors/validation',
        title: 'Validation Error',
        status: 400,
        detail: 'The request input failed validation.',
        instance,
        requestId,
        errors: mapZodError(err),
      });
  }

  if (err instanceof AppError) {
    return res
      .status(err.status)
      .type('application/problem+json')
      .json({
        type: err.type,
        title: err.title,
        status: err.status,
        detail: err.detail,
        instance,
        requestId,
        ...err.extensions,
      });
  }

  // Unexpected errors
  logger.error('Unhandled server error:', {
    message: err.message,
    stack: err.stack,
    requestId,
    path: req.path,
    method: req.method,
  });

  // Don't leak internals in production
  res
    .status(500)
    .type('application/problem+json')
    .json({
      type: 'https://syncro.app/errors/internal',
      title: 'Internal Server Error',
      status: 500,
      detail: 'An unexpected error occurred.',
      instance,
      requestId,
    });
};
