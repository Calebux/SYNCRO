import { Router, Response, NextFunction } from 'express'
import {
  getGmailAuthUrl,
  exchangeGmailCodeForTokens,
  getGmailProfile,
  scanGmailSubscriptions,
} from '../../services/gmail-service'
import { createState, consumeState } from '../../../utils/oauth-state'
import { supabase } from '../../config/database'
import { AuthenticatedRequest } from '../../middleware/auth'

const router: Router = Router()

// GET /api/integrations/gmail/auth
// Redirect user to Google's consent screen
router.get('/auth', (_req: AuthenticatedRequest, res: Response) => {
  const state = createState()
  const url = getGmailAuthUrl(state)
  res.redirect(url)
})

// GET /api/integrations/gmail/callback
// Google redirects here after the user grants permission; saves tokens to email_accounts
router.get('/callback', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const code = req.query.code as string | undefined
    const state = req.query.state as string | undefined

    if (!consumeState(state)) {
      return res.status(400).json({ error: 'Invalid OAuth state' })
    }

    if (!code) {
      return res.status(400).json({ error: 'Missing OAuth code' })
    }

    const tokens = await exchangeGmailCodeForTokens(code)
    const profile = await getGmailProfile(tokens)

    const { error: dbError } = await supabase
      .from('email_accounts')
      .upsert(
        {
          user_id: req.user!.id,
          provider: 'gmail',
          email: profile.emailAddress,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token ?? null,
          token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,provider,email' },
      )

    if (dbError) throw dbError

    return res.json({
      provider: 'gmail',
      email: profile.emailAddress,
      tokens: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiry_date: tokens.expiry_date,
        scope: tokens.scope,
        token_type: tokens.token_type,
      },
    })
  } catch (error) {
    return next(error)
  }
})

// POST /api/integrations/gmail/scan
// Trigger email scan and return detected subscriptions
router.post('/scan', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { accessToken, refreshToken, sinceDays, maxResults } = req.body as {
      accessToken?: string
      refreshToken?: string
      sinceDays?: number
      maxResults?: number
    }

    if (!accessToken) {
      return res.status(400).json({ error: 'Missing accessToken' })
    }

    const subscriptions = await scanGmailSubscriptions({
      accessToken,
      refreshToken,
      sinceDays,
      maxResults,
    })

    return res.json({ subscriptions })
  } catch (error) {
    return next(error)
  }
})

// DELETE /api/integrations/gmail/:id
// Disconnect a Gmail account
router.delete('/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params

    const { error, count } = await supabase
      .from('email_accounts')
      .delete({ count: 'exact' })
      .eq('id', id)
      .eq('user_id', req.user!.id)
      .eq('provider', 'gmail')

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