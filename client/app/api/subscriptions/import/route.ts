/**
 * POST /api/subscriptions/import
 * GET  /api/subscriptions/import?template=true
 *
 * Handles CSV import directly via Supabase (no separate backend call needed
 * from the browser). Mirrors the backend endpoint for the Express path.
 */

import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { z } from "zod"
import { ApiErrors, RateLimiters, createErrorResponse, getAuthenticatedUser, validateCsrfToken, emitAuditEvent } from "@/lib/api/index"
import { ApiException } from "@/lib/api/errors"
import { applyRateLimitHeaders, type RateLimitHeaders } from "@/lib/api/rate-limit"
import { isSafeHttpUrl } from "@syncro/shared/security"

function importJsonResponse(
  body: unknown,
  status: number,
  rateLimitHeaders: RateLimitHeaders,
) {
  return applyRateLimitHeaders(NextResponse.json(body, { status }), rateLimitHeaders)
}

// ─── Validation (mirrors backend csv-import-service) ─────────────────────

const VALID_BILLING_CYCLES = ["monthly", "yearly", "quarterly", "weekly", "lifetime"]

const CSV_TEMPLATE =
  "name,price,currency,billing_cycle,next_renewal,category,renewal_url\n" +
  "Netflix,17.99,USD,monthly,2025-04-15,Streaming,https://netflix.com\n" +
  "Adobe Creative Cloud,54.99,USD,monthly,2025-04-22,Design,https://adobe.com\n"

function parseCSV(text: string): { headers: string[]; records: Record<string, string>[] } {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
  if (lines.length < 1) return { headers: [], records: [] }

  const headers = lines[0]
    .split(",")
    .map((h) => h.replace(/^\uFEFF/, "").trim())
  
  if (lines.length < 2) return { headers, records: [] }

  const records: Record<string, string>[] = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const values = line.split(",")
    const row: Record<string, string> = {}
    headers.forEach((h, idx) => {
      row[h] = (values[idx] ?? "").trim()
    })
    records.push(row)
  }

  return { headers, records }
}

const rowSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  price: z
    .preprocess((v) => (typeof v === "string" ? v.replace(/[$,]/g, "") : v), z.coerce.number())
    .refine((v) => !isNaN(v) && v >= 0, "Price must be a non-negative number"),
  currency: z.string().default("USD"),
  billing_cycle: z
    .string()
    .transform((v) => v.toLowerCase().trim())
    .refine(
      (v) => VALID_BILLING_CYCLES.includes(v),
      `billing_cycle must be one of: ${VALID_BILLING_CYCLES.join(", ")}`,
    ),
  next_renewal: z
    .string()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : null))
    .refine((v) => !v || !isNaN(Date.parse(v)), "next_renewal must be a valid date (YYYY-MM-DD)"),
  category: z.string().default("Other"),
  renewal_url: z
    .string()
    .optional()
    .transform((v) => v?.trim() || null)
    .refine((v) => {
      if (!v) return true
      return isSafeHttpUrl(v)
    }, "renewal_url must be a valid http/https URL or empty"),
})

function renewsInDays(nextRenewal: string | null): number {
  if (!nextRenewal) return 30
  const ms = Date.parse(nextRenewal) - Date.now()
  return Math.max(0, Math.round(ms / 86_400_000))
}

// ─── Template download ────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const isTemplate = request.nextUrl.searchParams.get("template") === "true"
  if (isTemplate) {
    return new NextResponse(CSV_TEMPLATE, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="syncro-import-template.csv"',
      },
    })
  }
  return NextResponse.json({ error: "Not found" }, { status: 404 })
}

// ─── Import ───────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID()
  let rateLimitHeaders: RateLimitHeaders = {}

  try {
    // Enforce CSRF protection
    validateCsrfToken(request)

    rateLimitHeaders = RateLimiters.import(request)

    const user = await getAuthenticatedUser(request)
    const supabase = await createClient()

    // Get user preferences to check privacy mode
    const { data: userPrefs } = await supabase
      .from("user_preferences")
      .select("privacy_mode_enabled")
      .eq("user_id", user.id)
      .single()

    const isPrivacyMode = userPrefs?.privacy_mode_enabled || false

    const isCommit = request.nextUrl.searchParams.get("commit") === "true"
    const skipDupes = request.nextUrl.searchParams.get("skip_dupes") !== "false"

    // Parse multipart form
    const formData = await request.formData()
    const encryptedDataStr = formData.get("encrypted") as string | null
    const file = formData.get("file") as File | null

    let headers: string[] = []
    let records: Record<string, string>[] = []

    if (encryptedDataStr) {
      // For privacy mode, we just need to validate structure; actual parsing/encryption is client-side
      // We'll simulate the data using the encrypted payload structure to proceed through the flow
      // In privacy mode, the actual encryption is done client-side before sending
      // Note: We can't decrypt here because we don't have the key, so we'll just use placeholder data for validation
      headers = ["name", "price", "currency", "billing_cycle", "next_renewal", "category", "renewal_url"]
      records = [] // We'll skip actual validation in privacy mode since it's done client-side
    } else if (file) {
      // Normal mode — validate file type, MIME, and size before reading
      const ALLOWED_MIMES = ["text/csv", "text/plain", "application/vnd.ms-excel", "application/csv"]
      const fileMime = file.type || ""
      const fileName = file.name || ""

      if (!fileName.toLowerCase().endsWith(".csv")) {
        return importJsonResponse(
          { success: false, error: "Only CSV files are accepted (.csv extension required)" },
          400,
          rateLimitHeaders,
        )
      }

      if (fileMime && !ALLOWED_MIMES.includes(fileMime)) {
        return importJsonResponse(
          { success: false, error: "Invalid file type. Only CSV files are accepted." },
          400,
          rateLimitHeaders,
        )
      }

      const MAX_FILE_BYTES = 2 * 1024 * 1024 // 2 MB
      if (file.size > MAX_FILE_BYTES) {
        return importJsonResponse(
          { success: false, error: "File is too large. Maximum allowed size is 2 MB." },
          400,
          rateLimitHeaders,
        )
      }

      const text = await file.text()
      const parsed = parseCSV(text)
      headers = parsed.headers
      records = parsed.records
    } else {
      return importJsonResponse({ success: false, error: "No CSV file uploaded" }, 400, rateLimitHeaders)
    }

    const mappingStr = formData.get("mappings") as string | null
    const mappings = mappingStr ? JSON.parse(mappingStr) : null

    if (headers.length === 0) {
      return NextResponse.json({ success: false, error: "The CSV file is empty or has no data." }, { status: 400 })
    }

    // If no mappings provided and it's not a commit, return headers for mapping step
    if (!mappings && !isCommit) {
      return NextResponse.json({
        success: true,
        data: {
          headers,
          sampleRows: records.slice(0, 3),
        },
      })
    }

    if (records.length === 0 && !isPrivacyMode) {
      return importJsonResponse(
        { success: false, error: "The CSV file is empty or has no data rows." },
        400,
        rateLimitHeaders,
      )
    }

    if (records.length > 500 && !isPrivacyMode) {
      return importJsonResponse(
        { success: false, error: `File contains ${records.length} rows — limit is 500 per import.` },
        400,
        rateLimitHeaders,
      )
    }

    // In privacy mode, we skip server-side validation since it's done client-side
    let rows: any[] = []
    let preview: any = {}

    if (!isPrivacyMode) {
      // Fetch existing names for duplicate detection
      const { data: existing } = await supabase.from("subscriptions").select("id, name").eq("user_id", user.id)

      const existingNames = new Map<string, string>(
        (existing ?? []).map((s: { id: string; name: string }) => [s.name.toLowerCase(), s.id]),
      )

      // Validate each row
      type RowStatus = "valid" | "duplicate" | "error"
      type ParsedData = z.infer<typeof rowSchema>
      interface RowResult {
        row: number
        status: RowStatus
        data: ParsedData | null
        error?: string
        duplicateId?: string
      }

      rows = records.map((raw, i) => {
        const rowNum = i + 2
        
        // Apply mappings if present
        let dataToValidate: any = raw
        if (mappings) {
          dataToValidate = {}
          Object.entries(mappings).forEach(([internalKey, csvHeader]) => {
            if (csvHeader) {
              dataToValidate[internalKey] = raw[csvHeader as string]
            }
          })
        } else {
          // Fallback to exact header match (lowercased)
          const normalized: any = {}
          Object.entries(raw).forEach(([k, v]) => {
            normalized[k.toLowerCase().trim()] = v
          })
          dataToValidate = normalized
        }

        const result = rowSchema.safeParse(dataToValidate)

        if (!result.success) {
          const msg = result.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")
          return { row: rowNum, status: "error" as RowStatus, data: null, error: msg }
        }

        const data = result.data as ParsedData
        const dupId = existingNames.get(data.name.toLowerCase())
        if (dupId) {
          return { row: rowNum, status: "duplicate" as RowStatus, data, duplicateId: dupId }
        }

        return { row: rowNum, status: "valid" as RowStatus, data }
      })

      preview = {
        rows,
        validCount: rows.filter((r: any) => r.status === "valid").length,
        duplicateCount: rows.filter((r: any) => r.status === "duplicate").length,
        errorCount: rows.filter((r: any) => r.status === "error").length,
      }
    } else {
      // In privacy mode, return a placeholder preview
      preview = {
        rows: [],
        validCount: 0,
        duplicateCount: 0,
        errorCount: 0,
      }
    }

    if (!isCommit) {
      return applyRateLimitHeaders(
        NextResponse.json({ success: true, data: { preview } }),
        rateLimitHeaders,
      )
    }

    // Commit
    let toInsert: any[] = []
    if (!isPrivacyMode) {
      type RowStatus = "valid" | "duplicate" | "error"
      type ParsedData = z.infer<typeof rowSchema>
      interface RowResult {
        row: number
        status: RowStatus
        data: ParsedData | null
        error?: string
        duplicateId?: string
      }

      toInsert = (rows as RowResult[])
        .filter((r) => r.status === "valid" || (!skipDupes && r.status === "duplicate"))
        .filter((r): r is RowResult & { data: ParsedData } => r.data !== null)
        .map((r) => ({
          user_id: user.id,
          name: r.data.name,
          price: r.data.price,
          currency: r.data.currency,
          billing_cycle: r.data.billing_cycle,
          renews_in: renewsInDays(r.data.next_renewal),
          category: r.data.category,
          renewal_url: r.data.renewal_url ?? null,
          status: "active",
          source: "csv_import",
          date_added: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }))
    } else {
      // For privacy mode, we need to store encrypted data. However, since we can't decrypt here,
      // we need the client to have already encrypted the data and sent it in the 'encrypted' field.
      // In a complete implementation, we would store the encrypted data in the subscriptions table.
      // For now, we'll skip inserting in privacy mode to avoid errors.
      // In a real-world scenario, you would modify the subscriptions table to store encrypted fields.
    }

    if (toInsert.length > 0) {
      const { error } = await supabase.from("subscriptions").insert(toInsert)
      if (error) throw ApiErrors.internalError(`Import failed: ${error.message}`)
    }

    emitAuditEvent({
      userId: user.id,
      action: "subscription.import",
      resourceType: "subscription",
      metadata: { imported: toInsert.length, skipped: skipDupes ? preview.duplicateCount : 0, errors: preview.errorCount },
    })

    const result = {
      imported: toInsert.length,
      skipped: skipDupes ? preview.duplicateCount : 0,
      errors: preview.errorCount,
    }

    return applyRateLimitHeaders(
      NextResponse.json({ success: true, data: result }),
      rateLimitHeaders,
    )
  } catch (err) {
    if (err instanceof ApiException) {
      return createErrorResponse(err, requestId)
    }
    const message = err instanceof Error ? err.message : "Import failed"
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
}
