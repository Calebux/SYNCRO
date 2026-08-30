import { Router, Response, NextFunction } from 'express'
import { scanImapSubscriptions, validateImapCredentials, encrypt, decrypt } from '../../services/imap-service'
import { createState, consumeState } from '../../../utils/oauth-state'
import { supabase } from '../../config/database'
import { AuthenticatedRequest } from '../../middleware/auth'
import { createLoginLimiter } from '../../middleware/rate-limit-factory'

const router: Router = Router()

// POST /api/integrations/yahoo/connect
// Connect Yahoo Mail account using app password
router.post('/connect', createLoginLimiter(), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string }

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' })
    }

    // Validate credentials first
    const isValid = await validateImapCredentials(email, password, 'yahoo')
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    // Encrypt password before storing
    const encryptedPassword = encrypt(password)

    const { error: dbError } = await supabase
      .from('email_accounts')
      .upsert(
        {
          user_id: req.user!.id,
          provider: 'yahoo',
          email,
          access_token: encryptedPassword,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,provider,email' },
      )

    if (dbError) throw dbError

    return res.json({
      provider: 'yahoo',
      email,
      success: true,
    })
  } catch (error) {
    return next(error)
  }
})

// POST /api/integrations/yahoo/scan
// Trigger email scan and return detected subscriptions
router.post('/scan', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { email, password, sinceDays, maxResults } = req.body as {
      email?: string
      password?: string
      sinceDays?: number
      maxResults?: number
    }

    let actualPassword = password

    // If password not provided, try to get it from the database
    if (!actualPassword && email) {
      const { data: account, error: dbError } = await supabase
        .from('email_accounts')
        .select('access_token')
        .eq('user_id', req.user!.id)
        .eq('email', email)
        .eq('provider', 'yahoo')
        .single()

      if (dbError || !account) {
        return res.status(400).json({ error: 'Account not found' })
      }

      actualPassword = decrypt(account.access_token)
    }

    if (!email || !actualPassword) {
      return res.status(400).json({ error: 'Email and password are required' })
    }

    const subscriptions = await scanImapSubscriptions({
      email,
      password: actualPassword,
      provider: 'yahoo',
      sinceDays,
      maxResults,
    })

    return res.json({ subscriptions })
  } catch (error) {
    return next(error)
  }
})

// DELETE /api/integrations/yahoo/:id
// Disconnect a Yahoo Mail account
router.delete('/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params

    const { error, count } = await supabase
      .from('email_accounts')
      .delete({ count: 'exact' })
      .eq('id', id)
      .eq('user_id', req.user!.id)
      .eq('provider', 'yahoo')

    if (error) throw error

    if (!count || count === 0) {
      return res.status(404).json({ error: 'Account not found' })
    }

    return res.json({ success: true })
  } catch (error) {
    return next(error)
  }
})

export default router
