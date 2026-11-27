/**
 * Sanitizes a CSV cell to prevent formula injection attacks.
 * 
 * Excel, Google Sheets, and LibreOffice Calc will execute formulas in cells
 * that start with =, +, -, @, tab (\t), or carriage return (\r).
 * 
 * This function prefixes such cells with a single quote (') to force them
 * to be treated as text rather than formulas.
 * 
 * @param value - The value to sanitize
 * @returns Sanitized string safe for CSV export
 */
export const sanitizeCSVCell = (value: any): string => {
  if (value === null || value === undefined) return ""

  const stringValue = String(value)

  // Prevent CSV injection by escaping cells that start with special characters
  const dangerousChars = ["=", "+", "-", "@", "\t", "\r"]
  if (dangerousChars.some((char) => stringValue.startsWith(char))) {
    return `'${stringValue}`
  }

  // Escape quotes and wrap in quotes if contains comma, newline, or quote
  if (stringValue.includes(",") || stringValue.includes("\n") || stringValue.includes('"')) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }

  return stringValue
}

/**
 * Generates a safe CSV string from headers and rows with formula injection protection.
 * 
 * @param headers - Array of column headers
 * @param rows - Array of row data (each row is an array of values)
 * @returns CSV string with all cells sanitized
 */
export const generateSafeCSV = (headers: string[], rows: any[][]) => {
  const sanitizedHeaders = headers.map(sanitizeCSVCell)
  const sanitizedRows = rows.map((row) => row.map(sanitizeCSVCell))

  return [sanitizedHeaders.join(","), ...sanitizedRows.map((row) => row.join(","))].join("\n")
}

/**
 * Downloads CSV content as a file with a safe filename.
 * 
 * @param content - The CSV content to download
 * @param filename - Base filename (will be sanitized and timestamped)
 */
export const downloadCSV = (content: string, filename: string) => {
  // Ensure filename is safe and unique
  const safeFilename = filename.replace(/[^a-z0-9_-]/gi, "_")
  const timestamp = new Date().toISOString().split("T")[0]
  const uniqueFilename = `${safeFilename}-${timestamp}.csv`

  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = uniqueFilename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)
}
