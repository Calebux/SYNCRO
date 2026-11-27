import { scanImapSubscriptions, validateImapCredentials, getProviderImapConfig } from '../src/services/imap-service'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'

jest.mock('imapflow')
jest.mock('mailparser')

describe('IMAP Service', () => {
  let mockClient: any
  let mockLock: any

  beforeEach(() => {
    jest.clearAllMocks()

    mockLock = {
      release: jest.fn(),
    }

    mockClient = {
      connect: jest.fn().mockResolvedValue(undefined),
      logout: jest.fn().mockResolvedValue(undefined),
      getMailboxLock: jest.fn().mockResolvedValue(mockLock),
      search: jest.fn().mockResolvedValue([1, 2]),
      fetchOne: jest.fn(),
    }

    ;(ImapFlow as jest.MockedClass<typeof ImapFlow>).mockImplementation(() => mockClient)
  })

  describe('getProviderImapConfig', () => {
    it('returns config for supported providers', () => {
      expect(getProviderImapConfig('yahoo')).toEqual({
        host: 'imap.mail.yahoo.com',
        port: 993,
        secure: true,
      })
      expect(getProviderImapConfig('icloud')).toEqual({
        host: 'imap.mail.me.com',
        port: 993,
        secure: true,
      })
    })

    it('returns null for unsupported provider', () => {
      expect(getProviderImapConfig('unknown')).toBeNull()
    })
  })

  describe('validateImapCredentials', () => {
    it('returns true when IMAP connection succeeds', async () => {
      const result = await validateImapCredentials('user@icloud.com', 'app-pass', 'icloud')

      expect(result).toBe(true)
      expect(mockClient.connect).toHaveBeenCalledTimes(1)
      expect(mockClient.logout).toHaveBeenCalledTimes(1)
    })

    it('returns false when authentication fails', async () => {
      const authError: any = new Error('Invalid login')
      authError.code = 'AuthenticationFailed'
      mockClient.connect.mockRejectedValueOnce(authError)

      const result = await validateImapCredentials('user@yahoo.com', 'wrong-pass', 'yahoo')

      expect(result).toBe(false)
      expect(mockClient.connect).toHaveBeenCalledTimes(1)
    })

    it('throws error for unsupported provider', async () => {
      await expect(
        validateImapCredentials('user@test.com', 'pass', 'unknown_provider')
      ).rejects.toThrow('Unsupported IMAP provider: unknown_provider')
    })

    it('rethrows network/server error', async () => {
      const networkError = new Error('Connection timeout')
      mockClient.connect.mockRejectedValueOnce(networkError)

      await expect(
        validateImapCredentials('user@icloud.com', 'pass', 'icloud')
      ).rejects.toThrow('Connection timeout')
    })
  })

  describe('scanImapSubscriptions', () => {
    it('scans inbox and returns extracted subscription metadata', async () => {
      mockClient.search.mockResolvedValue([10])
      mockClient.fetchOne.mockResolvedValue({
        seq: 10,
        uid: 100,
        source: Buffer.from('Email content'),
        envelope: {
          subject: 'Your Netflix Subscription Receipt',
          date: new Date('2026-01-15T10:00:00Z'),
          from: [{ name: 'Netflix', address: 'info@netflix.com' }],
        },
      })

      ;(simpleParser as jest.Mock).mockResolvedValue({
        subject: 'Your Netflix Subscription Receipt',
        from: { text: '"Netflix" <info@netflix.com>' },
        date: new Date('2026-01-15T10:00:00Z'),
        text: 'Your monthly subscription of $15.99 was billed on your account.',
      })

      const results = await scanImapSubscriptions({
        email: 'user@icloud.com',
        password: 'password',
        provider: 'icloud',
      })

      expect(results).toHaveLength(1)
      expect(results[0]).toMatchObject({
        provider: 'icloud',
        messageId: '100',
        receivedAt: '2026-01-15T10:00:00.000Z',
        name: 'Netflix',
        amount: 15.99,
        currency: 'USD',
        interval: 'monthly',
        bodyExcluded: true,
      })

      expect(results[0].proof.hash).toBeDefined()
      expect(results[0].proof.contentHash).toBeDefined()

      expect(mockLock.release).toHaveBeenCalledTimes(1)
      expect(mockClient.logout).toHaveBeenCalledTimes(1)
    })

    it('returns empty array when no emails match search', async () => {
      mockClient.search.mockResolvedValue([])

      const results = await scanImapSubscriptions({
        email: 'user@yahoo.com',
        password: 'password',
        provider: 'yahoo',
      })

      expect(results).toEqual([])
      expect(mockLock.release).toHaveBeenCalledTimes(1)
      expect(mockClient.logout).toHaveBeenCalledTimes(1)
    })

    it('surfaces IMAP connection error to caller', async () => {
      mockClient.connect.mockRejectedValueOnce(new Error('IMAP server unavailable'))

      await expect(
        scanImapSubscriptions({
          email: 'user@icloud.com',
          password: 'password',
          provider: 'icloud',
        })
      ).rejects.toThrow('IMAP server unavailable')
    })

    it('releases lock and logs out even when search/fetch fails', async () => {
      mockClient.search.mockRejectedValueOnce(new Error('Mailbox error'))

      await expect(
        scanImapSubscriptions({
          email: 'user@yahoo.com',
          password: 'password',
          provider: 'yahoo',
        })
      ).rejects.toThrow('Mailbox error')

      expect(mockLock.release).toHaveBeenCalledTimes(1)
      expect(mockClient.logout).toHaveBeenCalledTimes(1)
    })
  })
})
