import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { csrfProtection } from '../src/middleware/csrf';

jest.mock('../src/config/logger');

function buildApp() {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use(csrfProtection);

  app.get('/api/data', (_req, res) => res.json({ ok: true }));
  app.post('/api/data', (_req, res) => res.json({ ok: true }));
  app.patch('/api/data', (_req, res) => res.json({ ok: true }));
  app.delete('/api/data', (_req, res) => res.json({ ok: true }));

  return app;
}

describe('CSRF Protection Middleware', () => {
  const app = buildApp();

  it('allows GET requests without csrf header', async () => {
    const res = await request(app).get('/api/data');
    expect(res.status).toBe(200);
  });

  it('sets csrf-token cookie on GET', async () => {
    const res = await request(app).get('/api/data');
    expect(res.headers['set-cookie']).toBeDefined();
    const cookieHeader = (res.headers['set-cookie'] as string[]).join(';');
    expect(cookieHeader).toMatch(/csrf-token=/);
  });

  it('rejects POST without x-csrf-token header', async () => {
    const res = await request(app).post('/api/data').send({});
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/x-csrf-token/);
  });

  it('rejects PATCH without x-csrf-token header', async () => {
    const res = await request(app).patch('/api/data').send({});
    expect(res.status).toBe(403);
  });

  it('rejects DELETE without x-csrf-token header', async () => {
    const res = await request(app).delete('/api/data');
    expect(res.status).toBe(403);
  });

  it('allows POST when x-csrf-token matches cookie', async () => {
    // First GET to obtain the token
    const getRes = await request(app).get('/api/data');
    const setCookieHeader = getRes.headers['set-cookie'] as string[];
    const tokenMatch = setCookieHeader.join(';').match(/csrf-token=([^;]+)/);
    expect(tokenMatch).not.toBeNull();
    const token = tokenMatch![1];

    const postRes = await request(app)
      .post('/api/data')
      .set('Cookie', `csrf-token=${token}`)
      .set('x-csrf-token', token)
      .send({});

    expect(postRes.status).toBe(200);
  });

  it('rejects POST when x-csrf-token does not match cookie', async () => {
    const getRes = await request(app).get('/api/data');
    const setCookieHeader = getRes.headers['set-cookie'] as string[];
    const tokenMatch = setCookieHeader.join(';').match(/csrf-token=([^;]+)/);
    const token = tokenMatch![1];

    const postRes = await request(app)
      .post('/api/data')
      .set('Cookie', `csrf-token=${token}`)
      .set('x-csrf-token', 'wrong-token')
      .send({});

    expect(postRes.status).toBe(403);
  });
});
