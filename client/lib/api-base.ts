const STAGING_API = 'https://backend-staging.onrender.com'
const PROD_API = 'https://backend-ai-sub.onrender.com'

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_API_BASE ||
  (process.env.NEXT_PUBLIC_APP_ENV === 'staging' ? STAGING_API : PROD_API)
