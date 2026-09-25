import { NextResponse } from 'next/server'

export function POST(): NextResponse {
    return NextResponse.json(
        { error: 'Stripe webhooks were retired with the v3 pivot.' },
        { status: 410 },
    )
}
