import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { parseSubscriptionEmail } from './email-parser'
import { generateProofHash, hashContent } from '../../utils/proof-hashing'
import { metadataExtractionOnly } from './email-scanner'
import type { RawScanResult, ReceiptMetadata } from './email-scanner'
import { EXTERNAL_SERVICE_POLICIES } from '../config/external-services'
import { encrypt, decrypt } from '../utils/encryption'
import logger from '../config/logger'

// Provider-specific IMAP configs
const PROVIDER_CONFIGS: Record<string, { host: string; port: number; secure: boolean }> = {
  yahoo: {
    host: 'imap.mail.yahoo.com',
    port: 993,
    secure: true
  },
  icloud: {
    host: 'imap.mail.me.com',
    port: 993,
    secure: true
  },
  outlook: {
    host: 'outlook.office365.com',
    port: 993,
    secure: true
  },
  gmail: {
    host: 'imap.gmail.com',
    port: 993,
    secure: true
  }
}

const KEYWORDS = [
  'subscription',
  'renewal',
  'invoice',
  'receipt',
  'billing',
  'charged',
  'trial',
  'membership',
  'plan'
]

interface ScanImapOptions {
  email: string
  password: string
  provider: string
  sinceDays?: number
  maxResults?: number
}

/**
 * Connects to an IMAP server and scans for subscription emails
 */
export async function scanImapSubscriptions(options: ScanImapOptions): Promise<ReceiptMetadata[]> {
  const { email, password, provider, sinceDays = 120, maxResults = 50 } = options

  const config = getProviderImapConfig(provider)
  if (!config) {
    throw new Error(`Unsupported IMAP provider: ${provider}`)
  }

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: email,
      pass: password,
    },
    logger: false,
  })
  const results: RawScanResult[] = []

  await client.connect()

  try {
    const lock = await client.getMailboxLock('INBOX')
    try {
      const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000)
      const searchResult = await client.search({ since: sinceDate })
      const messages = Array.isArray(searchResult) ? searchResult : []

      if (messages.length > 0) {
        // Limit to maxResults (take the newest messages)
        const targetSeq = messages.slice(-maxResults)

        for (const seq of targetSeq) {
          const fetched = await client.fetchOne(String(seq), { source: true, envelope: true })
          if (!fetched || !fetched.source) continue

          const parsedEmail = await simpleParser(fetched.source)
          const subject = fetched.envelope?.subject ?? parsedEmail.subject ?? ''

          let from = ''
          if (fetched.envelope?.from && fetched.envelope.from.length > 0) {
            const firstFrom = fetched.envelope.from[0]
            from = firstFrom.name ? `"${firstFrom.name}" <${firstFrom.address}>` : (firstFrom.address || '')
          } else if (parsedEmail.from?.text) {
            from = parsedEmail.from.text
          }

          const receivedAt = fetched.envelope?.date
            ? new Date(fetched.envelope.date).toISOString()
            : (parsedEmail.date ? new Date(parsedEmail.date).toISOString() : new Date().toISOString())

          let body: string | null = parsedEmail.text || parsedEmail.html || ''

          const parsed = parseSubscriptionEmail({ subject, from, body })
          if (!parsed) continue

          const contentHash = hashContent(body)
          // Discard raw email content after hashing/parsing for privacy compliance
          body = null

          const messageId = String(fetched.uid || fetched.seq || seq)
          const proofHash = generateProofHash({
            provider,
            messageId,
            receivedAt,
            subject,
            from,
            amount: parsed.amount,
            currency: parsed.currency,
            interval: parsed.interval,
            contentHash,
          })

          results.push({
            provider,
            messageId,
            threadId: null,
            receivedAt,
            subject,
            from,
            ...parsed,
            proof: {
              hash: proofHash,
              contentHash,
              algorithm: 'sha256',
            },
          })
        }
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout()
  }

  return metadataExtractionOnly(results)
}

/**
 * Validates IMAP connection credentials
 */
export async function validateImapCredentials(email: string, password: string, provider: string): Promise<boolean> {
  const config = getProviderImapConfig(provider)
  if (!config) {
    throw new Error(`Unsupported IMAP provider: ${provider}`)
  }

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: email,
      pass: password,
    },
    logger: false,
  })

  try {
    await client.connect()
    await client.logout()
    return true
  } catch (err: any) {
    if (
      err.code === 'AuthenticationFailed' ||
      err.authenticationFailed ||
      /invalid|authentication|login|denied|unauthorized/i.test(err.message || '')
    ) {
      return false
    }
    throw err
  }
}

/**
 * Gets provider-specific IMAP config
 */
export function getProviderImapConfig(provider: string) {
  return PROVIDER_CONFIGS[provider] || null
}

export { encrypt, decrypt }
