import { NextRequest, NextResponse } from 'next/server'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string; token: string }> },
) {
  const { userId, token } = await params
  const normalizedToken = token.endsWith('.ics') ? token.slice(0, -4) : token
  const backendUrl = `${API_BASE}/api/calendar/feed/${userId}/${normalizedToken}.ics`

  try {
    const response = await fetch(backendUrl, {
      headers: { Accept: 'text/calendar' },
      cache: 'no-store',
    })

    const body = await response.text()

    return new NextResponse(body, {
      status: response.status,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'attachment; filename="subscriptions.ics"',
        'Cache-Control': 'private, max-age=300',
      },
    })
  } catch {
    return new NextResponse('Failed to fetch calendar feed', { status: 502 })
  }
}
