import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * Generate a signed URL for downloading a stored invoice document.
 *
 * Self-contained route: talks to Supabase Storage directly using server-side
 * credentials. Must NOT import backend modules (the root app is a separate
 * Next.js boundary).
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const path = searchParams.get('path')

  if (!path) {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 })
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[invoice-url] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  const bucket = process.env.INVOICE_BUCKET || 'invoices'
  const expiresIn = parseInt(process.env.INVOICE_URL_EXPIRY || '3600', 10)

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn)

  if (error || !data?.signedUrl) {
    console.error('[invoice-url] failed to create signed URL', {
      bucket,
      path,
      error: error?.message,
    })
    return NextResponse.json({ error: 'Failed to generate invoice download URL' }, { status: 500 })
  }

  return NextResponse.json({ url: data.signedUrl })
}