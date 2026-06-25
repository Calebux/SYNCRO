import { NextResponse } from 'next/server'
import { getInvoiceSignedUrl } from '@/backend/src/services/invoice.service'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const path = searchParams.get('path')

  if (!path) {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 })
  }

  const url = await getInvoiceSignedUrl(path)

  return NextResponse.json({ url })
}