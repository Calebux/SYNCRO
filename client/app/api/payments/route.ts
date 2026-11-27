import { NextResponse } from 'next/server'

export function POST(): NextResponse {
    return NextResponse.json(
        { error: 'Payment processor integrations were retired with the v3 pivot.' },
        { status: 410 },
    )
}
