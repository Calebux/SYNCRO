/**
 * Client-side helpers for the invoice API.
 */

export interface SignedInvoiceUrl {
  url: string
  fileName: string
  expiresIn: number
}

/**
 * Fetch a short-lived signed URL for viewing an invoice PDF. Same-origin call,
 * so the Supabase session cookie authenticates the request.
 */
export async function getInvoiceSignedUrl(invoiceId: string): Promise<SignedInvoiceUrl> {
  const res = await fetch(`/api/invoices/${invoiceId}/signed-url`, {
    method: "GET",
    headers: { Accept: "application/json" },
  })

  const body = await res.json().catch(() => null)
  if (!res.ok || !body?.success) {
    throw new Error(body?.error?.message || `Failed to load invoice (${res.status})`)
  }
  return body.data as SignedInvoiceUrl
}
