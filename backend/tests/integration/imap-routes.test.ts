import express from 'express'
import request from 'supertest'
import icloudRouter from '../../src/routes/integrations/icloud'
import yahooRouter from '../../src/routes/integrations/yahoo'
import { validateImapCredentials, scanImapSubscriptions } from '../../src/services/imap-service'
import { supabase } from '../../src/config/database'
import { errorHandler } from '../../src/middleware/errorHandler'

jest.mock('../../src/services/imap-service', () => ({
  validateImapCredentials: jest.fn(),
  scanImapSubscriptions: jest.fn(),
  encrypt: jest.fn((val: string) => `encrypted_${val}`),
  decrypt: jest.fn((val: string) => val.replace('encrypted_', '')),
}))

jest.mock('../../src/config/database', () => ({
  supabase: {
    from: jest.fn(),
  },
}))

describe('IMAP Integration Routes (iCloud & Yahoo)', () => {
  const app = express()

  const emailAccountsTable = {
    upsert: jest.fn(),
    select: jest.fn(),
    eq: jest.fn(),
    single: jest.fn(),
    delete: jest.fn(),
  }

  beforeAll(() => {
    app.use(express.json())
    app.use((req, _res, next) => {
      ;(req as any).user = { id: 'user-456' }
      next()
    })
    app.use('/api/integrations/icloud', icloudRouter)
    app.use('/api/integrations/yahoo', yahooRouter)
    app.use(errorHandler)
  })

  beforeEach(() => {
    jest.clearAllMocks()

    emailAccountsTable.upsert.mockResolvedValue({ error: null })
    emailAccountsTable.select.mockReturnValue(emailAccountsTable)
    emailAccountsTable.eq.mockReturnValue(emailAccountsTable)
    emailAccountsTable.delete.mockReturnValue(emailAccountsTable)

    ;(supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'email_accounts') {
        return emailAccountsTable
      }
      throw new Error(`Unexpected table: ${table}`)
    })
  })

  describe('iCloud Routes', () => {
    it('POST /connect - returns 400 when email or password is missing', async () => {
      const res = await request(app).post('/api/integrations/icloud/connect').send({ email: 'test@icloud.com' })
      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Email and app-specific password are required')
    })

    it('POST /connect - returns 401 when IMAP credentials are invalid', async () => {
      ;(validateImapCredentials as jest.Mock).mockResolvedValueOnce(false)

      const res = await request(app).post('/api/integrations/icloud/connect').send({
        email: 'test@icloud.com',
        password: 'wrongpassword',
      })

      expect(res.status).toBe(401)
      expect(res.body.error).toBe('Invalid credentials')
      expect(validateImapCredentials).toHaveBeenCalledWith('test@icloud.com', 'wrongpassword', 'icloud')
    })

    it('POST /connect - connects and stores encrypted credentials when valid', async () => {
      ;(validateImapCredentials as jest.Mock).mockResolvedValueOnce(true)

      const res = await request(app).post('/api/integrations/icloud/connect').send({
        email: 'user@icloud.com',
        password: 'app-password-123',
      })

      expect(res.status).toBe(200)
      expect(res.body).toEqual({
        provider: 'icloud',
        email: 'user@icloud.com',
        success: true,
      })
      expect(emailAccountsTable.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user-456',
          provider: 'icloud',
          email: 'user@icloud.com',
          access_token: 'encrypted_app-password-123',
        }),
        { onConflict: 'user_id,provider,email' }
      )
    })

    it('POST /scan - returns subscription scan results', async () => {
      const mockSubscriptions = [
        {
          provider: 'icloud',
          messageId: '101',
          name: 'Spotify',
          amount: 9.99,
          currency: 'USD',
          interval: 'monthly',
          bodyExcluded: true,
        },
      ]
      ;(scanImapSubscriptions as jest.Mock).mockResolvedValueOnce(mockSubscriptions)

      const res = await request(app).post('/api/integrations/icloud/scan').send({
        email: 'user@icloud.com',
        password: 'app-password-123',
      })

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ subscriptions: mockSubscriptions })
      expect(scanImapSubscriptions).toHaveBeenCalledWith({
        email: 'user@icloud.com',
        password: 'app-password-123',
        provider: 'icloud',
        sinceDays: undefined,
        maxResults: undefined,
      })
    })

    it('POST /scan - surfaces error when scanImapSubscriptions fails', async () => {
      ;(scanImapSubscriptions as jest.Mock).mockRejectedValueOnce(new Error('IMAP connection reset'))

      const res = await request(app).post('/api/integrations/icloud/scan').send({
        email: 'user@icloud.com',
        password: 'app-password-123',
      })

      expect(res.status).toBe(500)
    })
  })

  describe('Yahoo Routes', () => {
    it('POST /connect - returns 401 when Yahoo credentials fail validation', async () => {
      ;(validateImapCredentials as jest.Mock).mockResolvedValueOnce(false)

      const res = await request(app).post('/api/integrations/yahoo/connect').send({
        email: 'user@yahoo.com',
        password: 'badpassword',
      })

      expect(res.status).toBe(401)
      expect(res.body.error).toBe('Invalid credentials')
      expect(validateImapCredentials).toHaveBeenCalledWith('user@yahoo.com', 'badpassword', 'yahoo')
    })

    it('POST /connect - stores account on valid credentials', async () => {
      ;(validateImapCredentials as jest.Mock).mockResolvedValueOnce(true)

      const res = await request(app).post('/api/integrations/yahoo/connect').send({
        email: 'user@yahoo.com',
        password: 'app-password-456',
      })

      expect(res.status).toBe(200)
      expect(res.body).toEqual({
        provider: 'yahoo',
        email: 'user@yahoo.com',
        success: true,
      })
    })

    it('POST /scan - triggers scan for Yahoo account', async () => {
      ;(scanImapSubscriptions as jest.Mock).mockResolvedValueOnce([])

      const res = await request(app).post('/api/integrations/yahoo/scan').send({
        email: 'user@yahoo.com',
        password: 'app-password-456',
      })

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ subscriptions: [] })
      expect(scanImapSubscriptions).toHaveBeenCalledWith({
        email: 'user@yahoo.com',
        password: 'app-password-456',
        provider: 'yahoo',
        sinceDays: undefined,
        maxResults: undefined,
      })
    })
  })
})
