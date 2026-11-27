import express from 'express';
import request from 'supertest';
import * as stellarSdk from '@stellar/stellar-sdk';
import walletRoutes from '../src/routes/wallet';
import { supabase } from '../src/config/database';

jest.mock('../src/config/database', () => ({
  supabase: {
    auth: {
      admin: {
        getUserById: jest.fn(),
        updateUserById: jest.fn(),
      },
    },
  },
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', role: 'member', authMethod: 'jwt', scopes: [] };
    next();
  },
}));

jest.mock('../src/config/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

describe('/api/wallet routes', () => {
  let app: express.Application;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/wallet', walletRoutes);
  });

  it('returns 400 when required verification fields are missing', async () => {
    const res = await request(app).post('/api/wallet/verify').send({ publicKey: 'GABC' });

    expect(res.status).toBe(400);
    expect(res.body.verified).toBe(false);
  });

  it('returns 400 for invalid Stellar public key', async () => {
    const res = await request(app).post('/api/wallet/verify').send({
      publicKey: 'invalid-key',
      message: 'test-message',
      signature: 'Zm9v',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid Stellar public key format/i);
  });

  it('returns 401 for invalid signature', async () => {
    const kp = stellarSdk.Keypair.random();
    const res = await request(app).post('/api/wallet/verify').send({
      publicKey: kp.publicKey(),
      message: 'test-message',
      signature: Buffer.from('not-a-real-signature').toString('base64'),
    });

    expect(res.status).toBe(401);
    expect(res.body.verified).toBe(false);
  });

  it('verifies wallet and persists metadata for valid signature', async () => {
    const kp = stellarSdk.Keypair.random();
    const message = 'verify-wallet-message';
    const signature = kp.sign(Buffer.from(message, 'utf8')).toString('base64');

    (supabase.auth.admin.getUserById as jest.Mock).mockResolvedValue({
      data: { user: { user_metadata: { display_name: 'Test User' } } },
      error: null,
    });
    (supabase.auth.admin.updateUserById as jest.Mock).mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    });

    const res = await request(app).post('/api/wallet/verify').send({
      publicKey: kp.publicKey(),
      message,
      signature,
    });

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.publicKey).toBe(kp.publicKey());
    expect(supabase.auth.admin.updateUserById).toHaveBeenCalledWith(
      'user-123',
      expect.objectContaining({
        user_metadata: expect.objectContaining({
          display_name: 'Test User',
          wallet_verification: expect.objectContaining({
            verified: true,
            publicKey: kp.publicKey(),
            verifiedAt: expect.any(String),
          }),
        }),
      }),
    );
  });

  it('returns unverified status when metadata is absent', async () => {
    (supabase.auth.admin.getUserById as jest.Mock).mockResolvedValue({
      data: { user: { user_metadata: {} } },
      error: null,
    });

    const res = await request(app).get('/api/wallet/status');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      verified: false,
      publicKey: null,
    });
  });

  it('returns verified status when metadata exists', async () => {
    (supabase.auth.admin.getUserById as jest.Mock).mockResolvedValue({
      data: {
        user: {
          user_metadata: {
            wallet_verification: {
              verified: true,
              publicKey: 'GABCD1234',
              verifiedAt: '2026-01-01T00:00:00.000Z',
            },
          },
        },
      },
      error: null,
    });

    const res = await request(app).get('/api/wallet/status');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      verified: true,
      publicKey: 'GABCD1234',
      verifiedAt: '2026-01-01T00:00:00.000Z',
    });
  });
});
