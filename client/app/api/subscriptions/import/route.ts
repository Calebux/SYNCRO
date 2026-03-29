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

// ─── Validation (mirrors backend csv-import-service) ─────────────────────

const VALID_BILLING_CYCLES = ["monthly", "yearly", "quarterly", "weekly", "lifetime"]

const CSV_TEMPLATE =
  "name,price,currency,billing_cycle,next_renewal,category,renewal_url\n" +
  "Netflix,17.99,USD,monthly,2025-04-15,Streaming,https://netflix.com\n" +
  "Adobe Creative Cloud,54.99,USD,monthly,2025-04-22,Design,https://adobe.com\n"

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
  if (lines.length < 2) return []

  const headers = lines[0].split(",").map((h) => h.replace(/^\uFEFF/, "").trim().toLowerCase())
  const rows: Record<string, string>[] = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const values = line.split(",")
    const row: Record<string, string> = {}
    headers.forEach((h, idx) => {
      row[h] = (values[idx] ?? "").trim()
    })
    rows.push(row)
  }

  return rows
}

const rowSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  price: z
    .string()
    .transform((v) => parseFloat(v.replace(/[$,]/g, "")))
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
      try {
        const { protocol } = new URL(v)
        return protocol === "http:" || protocol === "https:"
      } catch {
        return false
      }
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
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })

    const isCommit = request.nextUrl.searchParams.get("commit") === "true"
    const skipDupes = request.nextUrl.searchParams.get("skip_dupes") !== "false"

    // Parse multipart form
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    if (!file) {
      return NextResponse.json({ success: false, error: "No CSV file uploaded" }, { status: 400 })
    }
    if (!file.name.endsWith(".csv")) {
      return NextResponse.json({ success: false, error: "Only CSV files are accepted" }, { status: 400 })
    }

    const text = await file.text()
    const records = parseCSV(text)

    if (records.length === 0) {
      return NextResponse.json({ success: false, error: "The CSV file is empty or has no data rows." }, { status: 400 })
    }
    if (records.length > 500) {
      return NextResponse.json(
        { success: false, error: `File contains ${records.length} rows — limit is 500 per import.` },
        { status: 400 },
      )
    }

    // Fetch existing names for duplicate detection
    const { data: existing } = await supabase
      .from("subscriptions")
      .select("id, name")
      .eq("user_id", user.id)

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

    const rows: RowResult[] = records.map((raw, i) => {
      const rowNum = i + 2
      const result = rowSchema.safeParse(raw)

      if (!result.success) {
        const msg = result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")
        return { row: rowNum, status: "error" as RowStatus, data: null, error: msg }
      }

      const data = result.data as ParsedData
      const dupId = existingNames.get(data.name.toLowerCase())
      if (dupId) {
        return { row: rowNum, status: "duplicate" as RowStatus, data, duplicateId: dupId }
      }

      return { row: rowNum, status: "valid" as RowStatus, data }
    })

    const preview = {
      rows,
      validCount: rows.filter((r) => r.status === "valid").length,
      duplicateCount: rows.filter((r) => r.status === "duplicate").length,
      errorCount: rows.filter((r) => r.status === "error").length,
    }

    if (!isCommit) {
      return NextResponse.json({ success: true, data: { preview } })
    }

    // Commit
    const toInsert = rows
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

    if (toInsert.length > 0) {
      const { error } = await supabase.from("subscriptions").insert(toInsert)
      if (error) throw new Error(`Import failed: ${error.message}`)
    }

    const result = {
      imported: toInsert.length,
      skipped: skipDupes ? preview.duplicateCount : 0,
      errors: preview.errorCount,
    }

    return NextResponse.json({ success: true, data: result })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed"
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
}
