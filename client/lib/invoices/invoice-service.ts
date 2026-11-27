/**
 * Invoice storage service
 *
 * Server-side helpers for managing PDF invoices in the private Supabase
 * `invoices` storage bucket (see migration
 * `20260724000000_create_invoices_storage.sql`).
 *
 * Invoices are viewed through short-lived **signed URLs** rather than public
 * links, and every operation is scoped to the owning user both here (defence in
 * depth) and by the bucket/row RLS policies.
 */

export const INVOICES_BUCKET = "invoices"

/** Lifetime of a generated signed URL, in seconds. */
export const SIGNED_URL_TTL_SECONDS = 300

/** Maximum accepted invoice size (10 MB), mirrored by the bucket config. */
export const MAX_INVOICE_BYTES = 10 * 1024 * 1024

export const INVOICE_CONTENT_TYPE = "application/pdf"

export type InvoiceSource = "upload" | "email"

export type InvoiceErrorCode =
  | "not_found"
  | "forbidden"
  | "invalid_file"
  | "storage_error"

/** Typed error so API routes can map failures onto the right HTTP status. */
export class InvoiceError extends Error {
  constructor(
    public readonly code: InvoiceErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "InvoiceError"
  }
}

export interface InvoiceRecord {
  id: string
  user_id: string
  subscription_id: string | null
  payment_id: string | null
  storage_path: string
  file_name: string
  content_type: string
  size_bytes: number
  source: InvoiceSource
  created_at: string
}

export interface SignedInvoiceUrl {
  url: string
  fileName: string
  expiresIn: number
}

export interface UploadInvoiceInput {
  /** Raw PDF bytes. */
  body: ArrayBuffer | Uint8Array | Blob
  fileName: string
  contentType: string
  sizeBytes: number
  subscriptionId?: string | null
  paymentId?: string | null
  source?: InvoiceSource
}

/**
 * Minimal structural view of the Supabase client used by this service. The real
 * server client satisfies this shape; tests can pass a light-weight mock.
 */
export interface InvoiceSupabaseClient {
  from(table: string): any
  storage: {
    from(bucket: string): {
      createSignedUrl(
        path: string,
        expiresIn: number,
      ): Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>
      upload(
        path: string,
        body: ArrayBuffer | Uint8Array | Blob,
        options?: { contentType?: string; upsert?: boolean },
      ): Promise<{ data: { path: string } | null; error: { message: string } | null }>
      remove(paths: string[]): Promise<{ data: unknown; error: { message: string } | null }>
    }
  }
}

/**
 * Generate a short-lived signed URL for viewing a user's invoice PDF.
 *
 * Ownership is verified against the `invoices` row before any URL is minted, so
 * an authenticated user can never obtain a link to another user's invoice even
 * if they guess an id.
 */
export async function getSignedInvoiceUrl(
  supabase: InvoiceSupabaseClient,
  userId: string,
  invoiceId: string,
): Promise<SignedInvoiceUrl> {
  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("id, user_id, storage_path, file_name")
    .eq("id", invoiceId)
    .single()

  if (error || !invoice) {
    throw new InvoiceError("not_found", "Invoice not found")
  }
  if (invoice.user_id !== userId) {
    throw new InvoiceError("forbidden", "You do not have access to this invoice")
  }

  const { data, error: signError } = await supabase.storage
    .from(INVOICES_BUCKET)
    .createSignedUrl(invoice.storage_path, SIGNED_URL_TTL_SECONDS)

  if (signError || !data?.signedUrl) {
    throw new InvoiceError(
      "storage_error",
      `Failed to generate signed URL${signError ? `: ${signError.message}` : ""}`,
    )
  }

  return {
    url: data.signedUrl,
    fileName: invoice.file_name,
    expiresIn: SIGNED_URL_TTL_SECONDS,
  }
}

/** Validate that an upload looks like an acceptable PDF invoice. */
export function assertValidInvoiceFile(contentType: string, sizeBytes: number): void {
  if (contentType !== INVOICE_CONTENT_TYPE) {
    throw new InvoiceError("invalid_file", "Only PDF invoices are supported")
  }
  if (sizeBytes <= 0) {
    throw new InvoiceError("invalid_file", "Invoice file is empty")
  }
  if (sizeBytes > MAX_INVOICE_BYTES) {
    throw new InvoiceError("invalid_file", "Invoice exceeds the 10 MB size limit")
  }
}

/**
 * Build the per-user object path for an invoice. The leading `<user_id>/`
 * segment is what the storage RLS policies key off, so it must never be
 * user-controlled.
 */
export function buildInvoicePath(userId: string): string {
  return `${userId}/${crypto.randomUUID()}.pdf`
}

/**
 * Upload a PDF invoice to the private bucket and record its metadata. Supports
 * both direct uploads and email-extracted invoices (via `source`).
 */
export async function uploadInvoice(
  supabase: InvoiceSupabaseClient,
  userId: string,
  input: UploadInvoiceInput,
): Promise<InvoiceRecord> {
  assertValidInvoiceFile(input.contentType, input.sizeBytes)

  const storagePath = buildInvoicePath(userId)

  const { error: uploadError } = await supabase.storage
    .from(INVOICES_BUCKET)
    .upload(storagePath, input.body, {
      contentType: INVOICE_CONTENT_TYPE,
      upsert: false,
    })

  if (uploadError) {
    throw new InvoiceError("storage_error", `Failed to upload invoice: ${uploadError.message}`)
  }

  const { data: record, error: insertError } = await supabase
    .from("invoices")
    .insert({
      user_id: userId,
      subscription_id: input.subscriptionId ?? null,
      payment_id: input.paymentId ?? null,
      storage_path: storagePath,
      file_name: input.fileName,
      content_type: INVOICE_CONTENT_TYPE,
      size_bytes: input.sizeBytes,
      source: input.source ?? "upload",
    })
    .select()
    .single()

  if (insertError || !record) {
    // Roll back the orphaned object so storage and metadata stay consistent.
    await supabase.storage.from(INVOICES_BUCKET).remove([storagePath])
    throw new InvoiceError(
      "storage_error",
      `Failed to save invoice metadata${insertError ? `: ${insertError.message}` : ""}`,
    )
  }

  return record as InvoiceRecord
}

/** List a user's invoices, most recent first, optionally filtered by subscription. */
export async function listInvoices(
  supabase: InvoiceSupabaseClient,
  userId: string,
  filter: { subscriptionId?: string } = {},
): Promise<InvoiceRecord[]> {
  let query = supabase
    .from("invoices")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })

  if (filter.subscriptionId) {
    query = query.eq("subscription_id", filter.subscriptionId)
  }

  const { data, error } = await query
  if (error) {
    throw new InvoiceError("storage_error", `Failed to list invoices: ${error.message}`)
  }
  return (data ?? []) as InvoiceRecord[]
}
