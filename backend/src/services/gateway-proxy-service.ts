import https from 'https';
import http from 'http';
import { IncomingMessage, OutgoingHttpHeaders } from 'http';
import logger from '../config/logger';

/**
 * Gateway Proxy Service
 * 
 * Proxies requests to upstream providers with:
 * - Transparent status code, header, and trailer preservation
 * - Streaming responses without buffering (low first-byte latency)
 * - Client disconnect handling for partial billing
 */

export interface ProxyOptions {
  upstreamUrl: string;
  method: string;
  headers: OutgoingHttpHeaders;
  body?: Buffer | string;
  timeoutMs?: number;
  onDisconnect?: () => void;
}

export interface ProxyResult {
  statusCode: number;
  headers: OutgoingHttpHeaders;
  success: boolean;
  disconnected: boolean;
  bytesStreamed: number;
}

export class GatewayProxyService {
  private readonly DEFAULT_TIMEOUT_MS = 30000; // 30s upstream timeout

  /**
   * Proxy a request to an upstream provider, streaming the response
   * without buffering it. Returns metadata about the proxy operation.
   */
  async proxyRequest(
    incomingReq: http.IncomingMessage,
    outgoingRes: http.ServerResponse,
    options: ProxyOptions
  ): Promise<ProxyResult> {
    const url = new URL(options.upstreamUrl);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;

    let bytesStreamed = 0;
    let disconnected = false;
    let upstreamResponse: IncomingMessage | null = null;

    return new Promise((resolve, reject) => {
      // Prepare upstream request options
      const requestOptions: https.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: options.method,
        headers: this.sanitizeHeaders(options.headers),
        timeout: options.timeoutMs || this.DEFAULT_TIMEOUT_MS,
      };

      logger.debug('Proxying request to upstream', {
        url: options.upstreamUrl,
        method: options.method,
      });

      // Create upstream request
      const upstreamReq = client.request(requestOptions, (upstream) => {
        upstreamResponse = upstream;

        // Preserve upstream status code
        outgoingRes.statusCode = upstream.statusCode || 200;

        // Preserve upstream headers (add SYNCRO metadata)
        const preservedHeaders = this.preserveHeaders(upstream.headers);
        Object.entries(preservedHeaders).forEach(([key, value]) => {
          if (value !== undefined) {
            outgoingRes.setHeader(key, value);
          }
        });

        // Add SYNCRO tracking header
        outgoingRes.setHeader('X-SYNCRO-Gateway', 'v1');

        logger.info('Upstream response received', {
          statusCode: upstream.statusCode,
          headers: Object.keys(upstream.headers),
        });

        // Stream response data without buffering
        upstream.on('data', (chunk: Buffer) => {
          bytesStreamed += chunk.length;
          
          // Check if client is still connected before writing
          if (!outgoingRes.writableEnded) {
            outgoingRes.write(chunk);
          }
        });

        upstream.on('end', () => {
          logger.debug('Upstream response complete', { bytesStreamed });
          
          if (!outgoingRes.writableEnded) {
            outgoingRes.end();
          }

          resolve({
            statusCode: upstream.statusCode || 200,
            headers: preservedHeaders,
            success: true,
            disconnected,
            bytesStreamed,
          });
        });

        upstream.on('error', (err) => {
          logger.error('Upstream response error', { error: err.message });
          
          if (!outgoingRes.headersSent) {
            outgoingRes.statusCode = 502;
            outgoingRes.setHeader('Content-Type', 'application/json');
            outgoingRes.end(JSON.stringify({
              error: 'Bad Gateway',
              message: 'Upstream provider error',
            }));
          }

          reject(err);
        });
      });

      // Handle upstream request timeout
      upstreamReq.on('timeout', () => {
        logger.warn('Upstream request timeout');
        upstreamReq.destroy();
        
        if (!outgoingRes.headersSent) {
          outgoingRes.statusCode = 504;
          outgoingRes.setHeader('Content-Type', 'application/json');
          outgoingRes.end(JSON.stringify({
            error: 'Gateway Timeout',
            message: 'Upstream provider timeout',
          }));
        }

        resolve({
          statusCode: 504,
          headers: {},
          success: false,
          disconnected: false,
          bytesStreamed: 0,
        });
      });

      // Handle upstream request errors
      upstreamReq.on('error', (err) => {
        logger.error('Upstream request error', { error: err.message });
        
        if (!outgoingRes.headersSent) {
          outgoingRes.statusCode = 502;
          outgoingRes.setHeader('Content-Type', 'application/json');
          outgoingRes.end(JSON.stringify({
            error: 'Bad Gateway',
            message: 'Failed to connect to upstream provider',
          }));
        }

        reject(err);
      });

      // Handle client disconnect mid-stream
      incomingReq.on('close', () => {
        if (!upstreamResponse || upstreamResponse.readableEnded) {
          return; // Normal completion
        }

        logger.warn('Client disconnected mid-stream', { bytesStreamed });
        disconnected = true;

        // Abort upstream request
        upstreamReq.destroy();

        // Trigger partial billing callback
        if (options.onDisconnect) {
          options.onDisconnect();
        }

        resolve({
          statusCode: upstreamResponse.statusCode || 200,
          headers: this.preserveHeaders(upstreamResponse.headers),
          success: false,
          disconnected: true,
          bytesStreamed,
        });
      });

      // Send request body if present
      if (options.body) {
        upstreamReq.write(options.body);
      }

      upstreamReq.end();
    });
  }

  /**
   * Sanitize outgoing headers (remove hop-by-hop headers)
   */
  private sanitizeHeaders(headers: OutgoingHttpHeaders): OutgoingHttpHeaders {
    const sanitized = { ...headers };
    
    // Remove hop-by-hop headers that shouldn't be forwarded
    const hopByHopHeaders = [
      'connection',
      'keep-alive',
      'proxy-authenticate',
      'proxy-authorization',
      'te',
      'trailer',
      'transfer-encoding',
      'upgrade',
    ];

    hopByHopHeaders.forEach(header => {
      delete sanitized[header];
    });

    return sanitized;
  }

  /**
   * Preserve incoming headers from upstream response
   */
  private preserveHeaders(headers: http.IncomingHttpHeaders): OutgoingHttpHeaders {
    const preserved: OutgoingHttpHeaders = {};
    
    // Preserve all headers except hop-by-hop
    Object.entries(headers).forEach(([key, value]) => {
      const lowerKey = key.toLowerCase();
      
      // Skip hop-by-hop headers
      if (this.isHopByHopHeader(lowerKey)) {
        return;
      }

      preserved[key] = value;
    });

    return preserved;
  }

  private isHopByHopHeader(header: string): boolean {
    const hopByHop = [
      'connection',
      'keep-alive',
      'proxy-authenticate',
      'proxy-authorization',
      'te',
      'trailer',
      'transfer-encoding',
      'upgrade',
    ];

    return hopByHop.includes(header);
  }
}

export const gatewayProxyService = new GatewayProxyService();
