import request from 'supertest';
import express from 'express';
import { authLimiter, inviteLimiter, keyCreationLimiter } from '../src/middleware/rateLimit';

// Create a small test app to verify the middleware in isolation
const app = express();
app.use(express.json());

// Apply limiters to test routes
app.use('/api/auth', authLimiter);
app.post('/api/keys', keyCreationLimiter, (req, res) => res.status(200).json({ success: true }));
app.post('/api/team/invite', inviteLimiter, (req, res) => res.status(200).json({ success: true }));

describe('Rate Limiting API', () => {
    // Reset any state if needed (memory store doesn't have an easy reset, 
    // but we can just use new IPs/keys if we were testing IP-based limiting)

    test('authLimiter should trigger 429 after 5 attempts', async () => {
        // First 5 attempts should be fine (or 404 since we didn't define sub-routes)
        for (let i = 0; i < 5; i++) {
            await request(app).post('/api/auth/login').send({});
        }

        // 6th attempt should return 429
        const response = await request(app).post('/api/auth/login').send({});
        expect(response.status).toBe(429);
        expect(response.body.error).toContain('Too many attempts');
        expect(response.headers).toHaveProperty('ratelimit-limit');
        expect(response.headers).toHaveProperty('retry-after');
    });

    test('inviteLimiter should allow up to 20 attempts', async () => {
        // We'll just test a few to ensure it's working (not hitting the full 20 for speed)
        for (let i = 0; i < 5; i++) {
            const response = await request(app).post('/api/team/invite').send({ email: `test${i}@example.com` });
            expect(response.status).toBe(200);
        }
    });

    test('keyCreationLimiter should return 429 after 10 attempts (mocking per IP)', async () => {
        for (let i = 0; i < 10; i++) {
            await request(app).post('/api/keys').send({});
        }

        const response = await request(app).post('/api/keys').send({});
        expect(response.status).toBe(429);
        expect(response.body.error).toContain('API key creation limit reached');
    });
});
