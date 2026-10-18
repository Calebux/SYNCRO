import type { IncomingMessage } from 'node:http';

export interface UpstreamRequestOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface UpstreamResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

/**
 * Build an AbortSignal that fires when the client disconnects mid-request.
 * Returns the signal plus a cleanup function to detach the listener once the
 * upstream call settles, so we don't leak listeners on keep-alive sockets.
 */
export function signalFromRequest(req: IncomingMessage): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();

  const onClose = () => {
    // `req.destroyed` / `req.aborted` indicate the client went away before we
    // finished writing the response. A normal close after the response is
    // complete should not abort anything, so guard on writableEnded.
    if (!req.writableEnded) {
      controller.abort(new Error('client disconnected'));
    }
  };

  if (req.destroyed || req.aborted) {
    controller.abort(new Error('client disconnected'));
  } else {
    req.once('close', onClose);
  }

  const cleanup = () => {
    req.removeListener('close', onClose);
  };

  return { signal: controller.signal, cleanup };
}

export async function callUpstream(
  options: UpstreamRequestOptions,
): Promise<UpstreamResponse> {
  const { url, method = 'GET', headers = {}, body, signal, timeoutMs } = options;

  const timeoutController = new AbortController();
  const timeoutHandle =
    timeoutMs !== undefined
      ? setTimeout(() => timeoutController.abort(new Error('upstream timeout')), timeoutMs)
      : undefined;

  const signals = [signal, timeoutController.signal].filter(
    (s): s is AbortSignal => s !== undefined,
  );
  const combinedSignal =
    signals.length > 1 && typeof AbortSignal.any === 'function'
      ? AbortSignal.any(signals)
      : signals[0];

  try {
    const res = await fetch(url, {
      method,
      headers,
      body,
      signal: combinedSignal,
    });

    const resHeaders: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      resHeaders[key] = value;
    });

    const arrayBuffer = await res.arrayBuffer();

    return {
      status: res.status,
      headers: resHeaders,
      body: Buffer.from(arrayBuffer),
    };
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}
