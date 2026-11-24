import { workersMetered, verifyProofWithWebCrypto } from '../workers';

describe('workersMetered', () => {
  it('should return 402 for paid endpoint without payment proof', async () => {
    const request = new Request('http://localhost/api/test', {
      method: 'GET',
    });

    const pricing = {
      'GET /api/test': 0.01,
    };

    const response = await workersMetered(request, pricing);

    expect(response.status).toBe(402);
    
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Payment Required');
  });

  it('should process free endpoint without payment proof', async () => {
    const request = new Request('http://localhost/api/free', {
      method: 'GET',
    });

    const pricing = {
      'GET /api/free': 0,
    };

    const response = await workersMetered(request, pricing, {
      handler: async () => {
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Syncro-Receipt')).toBeDefined();
    
    const receipt = JSON.parse(response.headers.get('X-Syncro-Receipt')!);
    expect(receipt.amount).toBe(0);
    expect(receipt.status).toBe('free');
  });

  it('should process paid endpoint with valid payment proof', async () => {
    const request = new Request('http://localhost/api/paid', {
      method: 'POST',
      headers: {
        'X-Syncro-Payment-Proof': 'valid-proof-abc123',
      },
    });

    const pricing = {
      'POST /api/paid': 0.05,
    };

    const response = await workersMetered(request, pricing, {
      handler: async () => {
        return new Response(JSON.stringify({ data: 'processed' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Syncro-Receipt')).toBeDefined();
    
    const receipt = JSON.parse(response.headers.get('X-Syncro-Receipt')!);
    expect(receipt.amount).toBe(0.05);
    expect(receipt.status).toBe('settled');
  });

  it('should use custom handler when provided', async () => {
    const request = new Request('http://localhost/api/custom', {
      method: 'GET',
      headers: {
        'X-Syncro-Payment-Proof': 'proof-123',
      },
    });

    const pricing = {
      'GET /api/custom': 0.02,
    };

    const customResponse = { custom: 'data', timestamp: Date.now() };

    const response = await workersMetered(request, pricing, {
      handler: async () => {
        return new Response(JSON.stringify(customResponse), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual(customResponse);
  });

  it('should merge receipt headers with handler response', async () => {
    const request = new Request('http://localhost/api/test', {
      method: 'GET',
      headers: {
        'X-Syncro-Payment-Proof': 'proof-456',
      },
    });

    const pricing = {
      'GET /api/test': 0.01,
    };

    const response = await workersMetered(request, pricing, {
      handler: async () => {
        return new Response('OK', {
          headers: { 'X-Custom-Header': 'custom-value' },
        });
      },
    });

    expect(response.headers.get('X-Syncro-Receipt')).toBeDefined();
    expect(response.headers.get('X-Custom-Header')).toBe('custom-value');
  });
});

describe('verifyProofWithWebCrypto', () => {
  it('should reject undefined proof', async () => {
    const result = await verifyProofWithWebCrypto(undefined, 0.01, 'USDC');
    expect(result).toBe(false);
  });

  it('should reject empty string proof', async () => {
    const result = await verifyProofWithWebCrypto('', 0.01, 'USDC');
    expect(result).toBe(false);
  });

  it('should reject short proof', async () => {
    const result = await verifyProofWithWebCrypto('abc', 0.01, 'USDC');
    expect(result).toBe(false);
  });

  it('should accept valid-looking proof (placeholder validation)', async () => {
    const result = await verifyProofWithWebCrypto(
      'valid-proof-with-sufficient-length-abc123',
      0.01,
      'USDC',
    );
    expect(result).toBe(true);
  });

  it('should accept base64-like proof', async () => {
    const result = await verifyProofWithWebCrypto(
      'SGVsbG8gd29ybGQhIFRoaXMgaXMgYSBiYXNlNjQgc3RyaW5n',
      0.05,
      'USDC',
    );
    expect(result).toBe(true);
  });
});
