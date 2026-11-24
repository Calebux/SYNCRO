/**
 * Example Cloudflare Worker with SYNCRO metered API.
 * 
 * This worker demonstrates:
 * - WebCrypto-only implementation (no Node.js built-ins)
 * - 402 Payment Required responses
 * - Payment proof verification
 * - Receipt generation
 * 
 * Test locally with: wrangler dev
 */

import { workersMetered } from '@syncro/sdk/provider/workers';

// Define pricing for each route
const pricing = {
  'GET /': 0,              // Free endpoint
  'GET /api/hello': 0.01,  // 1 cent per request
  'POST /api/data': 0.05,  // 5 cents per request
  'GET /api/premium': 0.10, // 10 cents per request
};

export interface Env {
  // Optional: Durable Object namespace for reservation state
  // RESERVATIONS?: DurableObjectNamespace;
  
  // Optional: KV namespace for storing payment receipts
  // RECEIPTS?: KVNamespace;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    
    // Health check endpoint (always free)
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Apply metering to all /api routes
    if (url.pathname.startsWith('/api')) {
      return workersMetered(request, pricing, {
        handler: async (req) => {
          const url = new URL(req.url);
          
          // Route handlers
          if (url.pathname === '/api/hello' && req.method === 'GET') {
            return new Response(
              JSON.stringify({
                message: 'Hello from SYNCRO-metered API!',
                timestamp: new Date().toISOString(),
                paid: true,
              }),
              {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              },
            );
          }
          
          if (url.pathname === '/api/data' && req.method === 'POST') {
            const body = await req.text();
            return new Response(
              JSON.stringify({
                received: body.length,
                processed: true,
                timestamp: new Date().toISOString(),
              }),
              {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              },
            );
          }
          
          if (url.pathname === '/api/premium' && req.method === 'GET') {
            return new Response(
              JSON.stringify({
                data: 'Premium content',
                features: ['advanced-analytics', 'priority-support', 'custom-integration'],
                timestamp: new Date().toISOString(),
              }),
              {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              },
            );
          }
          
          return new Response(
            JSON.stringify({ error: 'Not Found' }),
            {
              status: 404,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        },
        
        // Optional: Custom failure handling
        onFailure: 'reject', // or 'serve-free' for degraded mode
        
        // Optional: Custom header names
        headerName: 'X-Syncro-Payment-Proof',
        receiptHeaderName: 'X-Syncro-Receipt',
      });
    }

    // Root endpoint with info
    if (url.pathname === '/') {
      return new Response(
        JSON.stringify({
          name: 'SYNCRO Cloudflare Worker Example',
          version: '1.0.0',
          endpoints: {
            '/': { price: 0, description: 'This info page (free)' },
            '/health': { price: 0, description: 'Health check (free)' },
            '/api/hello': { price: 0.01, description: 'Hello world endpoint' },
            '/api/data': { price: 0.05, description: 'Data processing endpoint' },
            '/api/premium': { price: 0.10, description: 'Premium content endpoint' },
          },
          payment: {
            protocol: 'x402',
            currency: 'USDC',
            headerName: 'X-Syncro-Payment-Proof',
          },
          docs: 'https://docs.syncro.dev',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    return new Response('Not Found', { status: 404 });
  },
};
