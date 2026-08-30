import { Router, Response, NextFunction } from 'express'
import {
  getOutlookAuthUrl,
  exchangeOutlookCodeForTokens,
  getOutlookProfile,
  scanOutlookSubscriptions,
} from '../../services/outlook-service'
import { encrypt, decrypt } from '../../utils/encryption'
import { createState, consumeState } from '../../../utils/oauth-state'
import { supabase } from '../../config/database'
import { AuthenticatedRequest } from '../../middleware/auth'

const router: Router = Router()

// GET /api/integrations/outlook/auth
// Redirect user to Microsoft's consent screen
router.get('/auth', (_req: AuthenticatedRequest, res: Response) => {
  const state = createState()
  const url = getOutlookAuthUrl(state)
  res.redirect(url)
})

// GET /api/integrations/outlook/callback
// Microsoft redirects here after the user grants permission; saves tokens to email_accounts
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

    const tokens = await exchangeOutlookCodeForTokens(code)
    const profile = await getOutlookProfile(tokens.access_token)

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    const email: string = profile.mail || profile.userPrincipalName

    const { error: dbError } = await supabase
      .from('email_accounts')
      .upsert(
        {
          user_id: req.user!.id,
          provider: 'outlook',
          email,
          access_token: encrypt(tokens.access_token),
          refresh_token: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
          token_expiry: expiresAt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,provider,email' },
      )

    if (dbError) throw dbError

    return res.json({
      provider: 'outlook',
      email,
      tokens: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: expiresAt,
        scope: tokens.scope,
        token_type: tokens.token_type,
      },
    })
  } catch (error) {
    return next(error)
  }
})

// POST /api/integrations/outlook/scan
// Trigger email scan and return detected subscriptions
router.post('/scan', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { accessToken, refreshToken, expiresAt, maxResults } = req.body as {
      accessToken?: string
      refreshToken?: string
      expiresAt?: string
      maxResults?: number
    }

    if (!accessToken) {
      return res.status(400).json({ error: 'Missing accessToken' })
    }

    // Attempt to decrypt the tokens in case they are passed encrypted
    // (If they aren't encrypted, decrypt() will return them as-is)
    const decryptedAccessToken = decrypt(accessToken);
    const decryptedRefreshToken = refreshToken ? decrypt(refreshToken) : undefined;

    const subscriptions = await scanOutlookSubscriptions({
      accessToken: decryptedAccessToken,
      refreshToken: decryptedRefreshToken,
      expiresAt,
      maxResults,
    })

    return res.json({ subscriptions })
  } catch (error) {
    return next(error)
  }
})

// DELETE /api/integrations/outlook/:id
// Disconnect an Outlook account
router.delete('/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params

    const { error, count } = await supabase
      .from('email_accounts')
      .delete({ count: 'exact' })
      .eq('id', id)
      .eq('user_id', req.user!.id)
      .eq('provider', 'outlook')

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