/**
 * Home page — the subscription dashboard that used to live here was torn
 * down in v3 (#1498). `/` now forwards to the principal overview.
 */

import { redirect } from 'next/navigation'

export default function HomePage() {
  redirect('/dashboard')
}
