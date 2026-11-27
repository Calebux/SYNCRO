import { v2RequestId, v2Success } from '@/lib/api/v2-envelope'

export async function GET(request: Request) {
  const requestId = v2RequestId(request)
  return v2Success(
    {
      status: 'ok',
      version: 'v2',
    },
    requestId,
  )
}
