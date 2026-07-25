import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  getSignedInvoiceUrl,
  uploadInvoice,
  listInvoices,
  assertValidInvoiceFile,
  buildInvoicePath,
  InvoiceError,
  INVOICES_BUCKET,
  SIGNED_URL_TTL_SECONDS,
  MAX_INVOICE_BYTES,
  type InvoiceSupabaseClient,
} from "../invoice-service"

// ─── Test doubles ────────────────────────────────────────────────────────────

function makeSupabase(overrides: {
  invoiceRow?: any
  invoiceError?: any
  signedUrl?: string | null
  signError?: any
  uploadError?: any
  insertRow?: any
  insertError?: any
  listRows?: any
  listError?: any
} = {}) {
  const single = vi.fn().mockResolvedValue({
    data: overrides.invoiceRow ?? null,
    error: overrides.invoiceError ?? null,
  })
  const insertSingle = vi.fn().mockResolvedValue({
    data: overrides.insertRow ?? null,
    error: overrides.insertError ?? null,
  })

  // Terminal for list queries: `.order()` resolves to the rows.
  const order = vi.fn().mockResolvedValue({
    data: overrides.listRows ?? [],
    error: overrides.listError ?? null,
  })

  const createSignedUrl = vi.fn().mockResolvedValue({
    data: overrides.signedUrl === null ? null : { signedUrl: overrides.signedUrl ?? "https://signed.example/inv.pdf" },
    error: overrides.signError ?? null,
  })
  const upload = vi.fn().mockResolvedValue({
    data: overrides.uploadError ? null : { path: "path" },
    error: overrides.uploadError ?? null,
  })
  const remove = vi.fn().mockResolvedValue({ data: {}, error: null })

  const selectBuilder: any = {
    eq: vi.fn(() => selectBuilder),
    order,
    single,
  }
  const insertBuilder: any = {
    select: vi.fn(() => ({ single: insertSingle })),
  }

  const from = vi.fn(() => ({
    select: vi.fn(() => selectBuilder),
    insert: vi.fn(() => insertBuilder),
  }))

  const storageFrom = { createSignedUrl, upload, remove }

  const client = {
    from,
    storage: { from: vi.fn(() => storageFrom) },
  } as unknown as InvoiceSupabaseClient

  return { client, single, createSignedUrl, upload, remove, insertSingle, order, storageFrom }
}

const OWNER = "user-owner-1"

describe("invoice-service", () => {
  beforeEach(() => vi.clearAllMocks())

  // ─── getSignedInvoiceUrl ───────────────────────────────────────────────────

  describe("getSignedInvoiceUrl", () => {
    it("mints a signed URL for an invoice the user owns", async () => {
      const { client, createSignedUrl } = makeSupabase({
        invoiceRow: {
          id: "inv-1",
          user_id: OWNER,
          storage_path: `${OWNER}/inv-1.pdf`,
          file_name: "march.pdf",
        },
      })

      const result = await getSignedInvoiceUrl(client, OWNER, "inv-1")

      expect(result.url).toBe("https://signed.example/inv.pdf")
      expect(result.fileName).toBe("march.pdf")
      expect(result.expiresIn).toBe(SIGNED_URL_TTL_SECONDS)
      expect(createSignedUrl).toHaveBeenCalledWith(`${OWNER}/inv-1.pdf`, SIGNED_URL_TTL_SECONDS)
    })

    it("rejects access to another user's invoice with a forbidden error", async () => {
      const { client, createSignedUrl } = makeSupabase({
        invoiceRow: {
          id: "inv-1",
          user_id: "someone-else",
          storage_path: "someone-else/inv-1.pdf",
          file_name: "secret.pdf",
        },
      })

      await expect(getSignedInvoiceUrl(client, OWNER, "inv-1")).rejects.toMatchObject({
        code: "forbidden",
      })
      // Critically, no URL is ever generated for a non-owner.
      expect(createSignedUrl).not.toHaveBeenCalled()
    })

    it("throws not_found when the invoice does not exist", async () => {
      const { client } = makeSupabase({ invoiceRow: null, invoiceError: { message: "no rows" } })
      await expect(getSignedInvoiceUrl(client, OWNER, "missing")).rejects.toMatchObject({
        code: "not_found",
      })
    })

    it("throws storage_error when signing fails", async () => {
      const { client } = makeSupabase({
        invoiceRow: { id: "inv-1", user_id: OWNER, storage_path: `${OWNER}/inv-1.pdf`, file_name: "x.pdf" },
        signedUrl: null,
        signError: { message: "bucket offline" },
      })
      await expect(getSignedInvoiceUrl(client, OWNER, "inv-1")).rejects.toMatchObject({
        code: "storage_error",
      })
    })
  })

  // ─── validation helpers ────────────────────────────────────────────────────

  describe("assertValidInvoiceFile", () => {
    it("accepts a reasonable PDF", () => {
      expect(() => assertValidInvoiceFile("application/pdf", 1024)).not.toThrow()
    })

    it("rejects non-PDF content types", () => {
      expect(() => assertValidInvoiceFile("image/png", 1024)).toThrow(InvoiceError)
    })

    it("rejects empty files", () => {
      expect(() => assertValidInvoiceFile("application/pdf", 0)).toThrow(/empty/)
    })

    it("rejects files over the size limit", () => {
      expect(() => assertValidInvoiceFile("application/pdf", MAX_INVOICE_BYTES + 1)).toThrow(/size limit/)
    })
  })

  describe("buildInvoicePath", () => {
    it("namespaces the object under the user's folder as a .pdf", () => {
      const path = buildInvoicePath(OWNER)
      expect(path.startsWith(`${OWNER}/`)).toBe(true)
      expect(path.endsWith(".pdf")).toBe(true)
    })
  })

  // ─── uploadInvoice ─────────────────────────────────────────────────────────

  describe("uploadInvoice", () => {
    it("uploads a PDF and records metadata under the user's folder", async () => {
      const insertRow = { id: "inv-9", user_id: OWNER, storage_path: `${OWNER}/x.pdf` }
      const { client, upload, storageFrom } = makeSupabase({ insertRow })

      const record = await uploadInvoice(client, OWNER, {
        body: new Uint8Array([1, 2, 3]),
        fileName: "april.pdf",
        contentType: "application/pdf",
        sizeBytes: 3,
      })

      expect(record.id).toBe("inv-9")
      expect(client.storage.from).toHaveBeenCalledWith(INVOICES_BUCKET)
      const [pathArg, , opts] = upload.mock.calls[0]
      expect(pathArg.startsWith(`${OWNER}/`)).toBe(true)
      expect(opts).toMatchObject({ contentType: "application/pdf", upsert: false })
      expect(storageFrom.remove).not.toHaveBeenCalled()
    })

    it("rejects a non-PDF before touching storage", async () => {
      const { client, upload } = makeSupabase()
      await expect(
        uploadInvoice(client, OWNER, {
          body: new Uint8Array([1]),
          fileName: "x.png",
          contentType: "image/png",
          sizeBytes: 1,
        }),
      ).rejects.toMatchObject({ code: "invalid_file" })
      expect(upload).not.toHaveBeenCalled()
    })

    it("rolls back the uploaded object if metadata insert fails", async () => {
      const { client, remove } = makeSupabase({ insertError: { message: "db down" } })
      await expect(
        uploadInvoice(client, OWNER, {
          body: new Uint8Array([1]),
          fileName: "x.pdf",
          contentType: "application/pdf",
          sizeBytes: 1,
        }),
      ).rejects.toMatchObject({ code: "storage_error" })
      expect(remove).toHaveBeenCalledTimes(1)
    })
  })

  // ─── listInvoices ──────────────────────────────────────────────────────────

  describe("listInvoices", () => {
    it("returns the user's invoices", async () => {
      const rows = [{ id: "a" }, { id: "b" }]
      const { client } = makeSupabase({ listRows: rows })
      const result = await listInvoices(client, OWNER)
      expect(result).toEqual(rows)
    })
  })
})
