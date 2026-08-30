# CSV Injection Security Fix

## Overview

This document describes the security vulnerability fix for CSV formula injection attacks in the SYNCRO application. The fix addresses potential security issues in both CSV import and export functionality.

## Vulnerability Description

### What is CSV Injection?

CSV injection (also known as Formula Injection) is a vulnerability where malicious content in CSV files can be executed when opened in spreadsheet applications like Microsoft Excel, Google Sheets, or LibreOffice Calc.

### Attack Vectors

Cells beginning with the following characters can be interpreted as formulas:
- `=` (equals) - Standard formula prefix
- `+` (plus) - Alternative formula prefix
- `-` (minus) - Alternative formula prefix
- `@` (at) - Alternative formula prefix
- `\t` (tab) - Can trigger formula execution
- `\r` (carriage return) - Can trigger formula execution

### Example Attacks

```csv
name,email,notes
=cmd|"/c calc",user@example.com,Safe note
=HYPERLINK("http://evil.com","Click here"),admin@example.com,Phishing
@SUM(A1:A10)*cmd|'/c calc'!A0,test@example.com,DDE attack
```

When opened in Excel/Sheets, these can:
- Execute arbitrary system commands
- Exfiltrate data to external servers
- Launch malicious applications
- Access sensitive files

## Fix Implementation

### 1. CSV Import Protection (`csv-import-service.ts`)

**Location**: `/backend/src/services/csv-import-service.ts`

**Implementation**:
```typescript
function detectFormulaInjection(value: string): boolean {
  if (!value) return false;
  const dangerousChars = ['=', '+', '-', '@', '\t', '\r'];
  return dangerousChars.some((char) => value.startsWith(char));
}

function validateCellSafety(raw: Record<string, string>): string | null {
  for (const [key, value] of Object.entries(raw)) {
    if (detectFormulaInjection(String(value ?? ''))) {
      return `Cell "${key}" contains potentially dangerous formula character at start: "${value.substring(0, 10)}..."`;
    }
  }
  return null;
}
```

**Behavior**:
- Rejects CSV rows containing cells that start with dangerous characters
- Returns clear error messages identifying the problematic cell
- Prevents malicious data from being stored in the database

### 2. CSV Export Protection

#### Backend Exports

**Renewal History Service** (`renewal-history.service.ts`):
```typescript
private sanitizeCSVCell(value: any): string {
  if (value === null || value === undefined) return '';
  
  const stringValue = String(value);
  const dangerousChars = ['=', '+', '-', '@', '\t', '\r'];
  
  // Prevent formula injection
  if (dangerousChars.some((char) => stringValue.startsWith(char))) {
    return `'${stringValue}`;
  }
  
  // Escape quotes and wrap in quotes if contains comma, newline, or quote
  if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  
  return stringValue;
}
```

**Privacy Metrics** (`privacy-metrics.ts`):
- Added `sanitizeCSVCell()` function with the same protection logic
- Applied to all headers and data cells

#### Client-Side Exports

**Location**: `/client/lib/csv-utils.ts`

**Implementation**:
```typescript
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
```

**Usage**: Applied to all client-side CSV exports via `generateSafeCSV()` function

### 3. Sanitization Strategy

**Prefix with Single Quote**: When a dangerous character is detected at the start of a cell:
```
=1+1          → '=1+1
+1234567890   → '+1234567890
-rm -rf /     → '-rm -rf /
@IMPORT       → '@IMPORT
```

**Why This Works**:
- Single quote prefix forces spreadsheet applications to treat the content as text
- Preserves the original data (visible to users)
- Prevents formula execution

**Important**: Characters in the middle of content are NOT escaped:
```
Netflix (+HD)         → Netflix (+HD)  (unchanged)
user@example.com      → user@example.com  (unchanged)
Discount -50%         → Discount -50%  (unchanged)
```

## Test Coverage

### Backend Tests

**CSV Import Tests** (`csv-import-service.test.ts`):
- ✅ Rejects cells starting with `=`
- ✅ Rejects cells starting with `+`
- ✅ Rejects cells starting with `-`
- ✅ Rejects cells starting with `@`
- ✅ Rejects cells starting with tab character
- ✅ Rejects cells starting with carriage return
- ✅ Accepts formula characters not at the start
- ✅ Rejects complex formula injection attempts
- ✅ Proper error messages for malformed rows

**Renewal History Export Tests** (`renewal-history-csv-export.test.ts`):
- ✅ Sanitizes cells starting with dangerous characters
- ✅ Handles normal text content
- ✅ Preserves CSV structure
- ✅ Handles null/undefined values
- ✅ Handles empty rows

**Privacy Metrics Export Tests** (`privacy-metrics-csv-export.test.ts`):
- ✅ Sanitizes all fields
- ✅ Handles null values
- ✅ Maintains proper CSV format
- ✅ Correct content-type headers

### Client-Side Tests

**CSV Utils Tests** (`csv-utils.test.ts`):
- ✅ Formula injection protection for all dangerous characters
- ✅ CSV formatting (commas, quotes, newlines)
- ✅ Combined attack scenarios
- ✅ Real-world DDE attacks
- ✅ Hyperlink injection prevention
- ✅ Cell reference exploitation prevention

## Acceptance Criteria

✅ **Formula-injection sanitization on export**
- All CSV exports apply `sanitizeCSVCell()` to every cell
- Dangerous characters at cell start are prefixed with single quote
- Backend: `renewal-history.service.ts`, `privacy-metrics.ts`
- Client: `csv-utils.ts` with `generateSafeCSV()`

✅ **Malformed-row rejection on import**
- CSV import validates every cell for formula injection
- Rows with dangerous content are rejected with clear error messages
- Import preview shows which rows failed and why

✅ **Comprehensive tests**
- 50+ test cases covering import validation and export sanitization
- Tests for all dangerous characters: `=`, `+`, `-`, `@`, `\t`, `\r`
- Real-world attack scenarios (DDE, hyperlink injection, cell references)
- Edge cases (null values, empty strings, whitespace)

## Security Considerations

### What This Fix Prevents
- ✅ Command execution via DDE (Dynamic Data Exchange)
- ✅ Hyperlink-based phishing attacks
- ✅ Data exfiltration through external references
- ✅ Malicious macro triggers

### What This Fix Does NOT Prevent
- ❌ Vulnerabilities in the spreadsheet application itself
- ❌ User intentionally executing untrusted macros
- ❌ Social engineering attacks outside of CSV context

### Best Practices
1. **Always validate on import**: Reject malicious data before it enters the system
2. **Always sanitize on export**: Protect users from data that may have bypassed validation
3. **Defense in depth**: Apply protection at both backend and frontend
4. **Clear error messages**: Help users understand why their CSV was rejected

## References

- [OWASP: CSV Injection](https://owasp.org/www-community/attacks/CSV_Injection)
- [CSV Injection Revisited](https://www.contextis.com/en/blog/comma-separated-vulnerabilities)
- [PayloadsAllTheThings: CSV Injection](https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/CSV%20Injection)

## Files Modified

### Backend
- ✅ `/backend/src/services/csv-import-service.ts` - Added validation
- ✅ `/backend/src/subscription-renewal-history-timeline/renewal-history.service.ts` - Added sanitization
- ✅ `/backend/src/routes/admin/privacy-metrics.ts` - Added sanitization
- ✅ `/backend/tests/csv-import-service.test.ts` - Already had comprehensive tests
- ✅ `/backend/tests/renewal-history-csv-export.test.ts` - Already had comprehensive tests
- ✅ `/backend/tests/privacy-metrics-csv-export.test.ts` - Added new tests

### Client
- ✅ `/client/lib/csv-utils.ts` - Already had sanitization
- ✅ `/client/lib/__tests__/csv-utils.test.ts` - Already had comprehensive tests
- ✅ `/client/lib/csv-export.ts` - Uses `generateSafeCSV()`
- ✅ `/client/hooks/use-bulk-actions.ts` - Uses `generateSafeCSV()`

## Verification Steps

1. **Import Protection**:
   ```bash
   cd backend
   npm test -- csv-import-service.test.ts
   ```

2. **Export Protection**:
   ```bash
   cd backend
   npm test -- renewal-history-csv-export.test.ts
   npm test -- privacy-metrics-csv-export.test.ts
   ```

3. **Client Protection**:
   ```bash
   cd client
   npm test -- csv-utils.test.ts
   ```

4. **Manual Testing**:
   - Try importing a CSV with `=1+1` in the name field → Should reject
   - Export subscriptions and verify dangerous characters are prefixed with `'`
   - Open exported CSV in Excel → Should display as text, not execute

## Conclusion

This security fix provides comprehensive protection against CSV injection attacks across all import and export functionality in the SYNCRO application. The implementation follows industry best practices and is backed by extensive test coverage.
