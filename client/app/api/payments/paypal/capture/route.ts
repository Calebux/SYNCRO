import { NextResponse } from 'next/server'

export function POST(): NextResponse {
    return NextResponse.json(
        { error: 'PayPal payment capture was retired with the v3 pivot.' },
        { status: 410 },
    )
}
