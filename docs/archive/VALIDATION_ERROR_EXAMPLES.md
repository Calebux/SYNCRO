# Validation Error Messages - User Examples

This document shows the exact error messages users will see when validation fails.

## Subscription Creation Errors

### Name Validation

**Error**: Missing name
```
Subscription name is required
```

**Error**: Name too long
```
Subscription name must not exceed 100 characters
```

### Price Validation

**Error**: Invalid price format
```
Price must be a valid number
```

**Error**: Negative price
```
Price must be zero or positive
```

**Error**: Price too high
```
Price must not exceed $100,000
```

### Billing Cycle Validation

**Error**: Invalid billing cycle
```
Billing cycle must be one of: monthly, yearly, quarterly, weekly, annual
```

### URL Validation

**Error**: Invalid renewal URL
```
Renewal URL must be a valid HTTP/HTTPS URL
```

**Error**: Invalid website URL
```
Website URL must be a valid HTTP/HTTPS URL
```

**Error**: Invalid logo URL
```
Logo URL must be a valid HTTP/HTTPS URL
```

### Category Validation

**Error**: Category too long
```
Category must not exceed 50 characters
```

### Notes Validation

**Error**: Notes too long
```
Notes must not exceed 5000 characters
```

### Trial Configuration Errors

**Error**: Trial enabled but no end date
```
Trial end date is required when trial is enabled
```

**Error**: Invalid trial end date
```
Trial end date must be a valid date and time
```

**Error**: Invalid trial conversion price
```
Trial conversion price must be zero or positive
```

### Status Validation

**Error**: Invalid status
```
Status must be one of: active, cancelled, expired, paused, trial
```

---

## Subscription Update Errors

All subscription update errors follow the same patterns as creation, but apply only to fields being updated.

### Example: Updating Price

**Error**: Invalid price in update
```
Price must be a valid number
```

### Example: Updating Status

**Error**: Invalid status in update
```
Status must be one of: active, cancelled, expired, paused, trial
```

### Example: Updating Next Billing Date

**Error**: Invalid next billing date
```
Next billing date must be a valid date and time
```

---

## Gift Card Hash Errors

### Type Validation

**Error**: Hash is not a string
```
Gift card hash must be a text value
```

### Required Field

**Error**: Hash is empty
```
Gift card hash is required
```

### Length Validation

**Error**: Hash too short
```
Gift card hash must be at least 32 characters
```

**Error**: Hash too long
```
Gift card hash must not exceed 64 characters
```

### Format Validation

**Error**: Hash contains non-hex characters
```
Gift card hash must contain only hexadecimal characters (0-9, a-f, A-F)
```

---

## Multiple Errors

When multiple validation rules fail, all errors are shown together, separated by newlines:

```
Subscription name is required
Price must be a valid number
Billing cycle must be one of: monthly, yearly, quarterly, weekly, annual
```

---

## Real-World Scenarios

### Scenario 1: User Creates Subscription with Invalid Data

**User Input**:
```javascript
{
  name: '',                    // Empty
  price: 'expensive',          // Not a number
  billing_cycle: 'biweekly',   // Invalid cycle
  renewal_url: 'not-a-url'     // Invalid URL
}
```

**Error Message Shown**:
```
Subscription name is required
Price must be a valid number
Billing cycle must be one of: monthly, yearly, quarterly, weekly, annual
Renewal URL must be a valid HTTP/HTTPS URL
```

### Scenario 2: User Updates Subscription with Invalid Price

**User Input**:
```javascript
{
  price: -50  // Negative price
}
```

**Error Message Shown**:
```
Price must be zero or positive
```

### Scenario 3: User Attaches Gift Card with Invalid Hash

**User Input**:
```javascript
{
  giftCardHash: 'invalid-hash-format'  // Contains dashes, not hex
}
```

**Error Message Shown**:
```
Gift card hash must contain only hexadecimal characters (0-9, a-f, A-F)
```

### Scenario 4: User Creates Trial Subscription Incorrectly

**User Input**:
```javascript
{
  name: 'Trial Subscription',
  price: 29.99,
  billing_cycle: 'monthly',
  is_trial: true
  // Missing trial_end_date
}
```

**Error Message Shown**:
```
Trial end date is required when trial is enabled
```

---

## Valid Examples (No Errors)

### Valid Subscription Creation

```javascript
{
  name: 'Netflix Premium',
  price: 19.99,
  billing_cycle: 'monthly',
  currency: 'USD',
  renewal_url: 'https://netflix.com/renew',
  website_url: 'https://netflix.com',
  logo_url: 'https://netflix.com/logo.png',
  category: 'Entertainment',
  notes: 'My favorite streaming service'
}
// ✅ Passes validation
```

### Valid Subscription Update

```javascript
{
  price: 22.99,
  status: 'active'
}
// ✅ Passes validation
```

### Valid Gift Card Hash

```javascript
{
  giftCardHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
}
// ✅ Passes validation (SHA-256 format)
```

---

## Error Message Localization

All error messages are designed to be:
- **Clear**: Explain what went wrong
- **Actionable**: Tell users how to fix it
- **Friendly**: Use conversational language
- **Specific**: Reference the exact field or constraint

For localization, translate these message templates:
- "X is required"
- "X must be a valid Y"
- "X must not exceed Y characters"
- "X must be one of: Y"
- "X must be zero or positive"
- "X must be at least Y characters"

---

## Testing Error Messages

To test error messages in development:

```typescript
import { validateSubscriptionCreateInput, ValidationError } from '@/lib/validation'

// Test invalid data
const invalidData = {
  name: '',
  price: 'invalid',
  billing_cycle: 'unknown'
}

try {
  validateSubscriptionCreateInput(invalidData)
} catch (error) {
  if (error instanceof ValidationError) {
    console.log('Error message:')
    console.log(error.message)
    // Output:
    // Subscription name is required
    // Price must be a valid number
    // Billing cycle must be one of: monthly, yearly, quarterly, weekly, annual
  }
}
```

---

## Integration with UI Components

### Toast Notification Example

```typescript
import { useToast } from '@/components/ui/use-toast'
import { validateSubscriptionCreateInput, ValidationError } from '@/lib/validation'

export function CreateSubscriptionForm() {
  const { toast } = useToast()

  const handleSubmit = async (data: any) => {
    try {
      validateSubscriptionCreateInput(data)
      await apiPost('/api/subscriptions', data)
      toast({
        title: 'Success',
        description: 'Subscription created successfully',
      })
    } catch (error) {
      if (error instanceof ValidationError) {
        toast({
          title: 'Validation Error',
          description: error.message,
          variant: 'destructive',
        })
      }
    }
  }

  return <form onSubmit={handleSubmit}>{/* ... */}</form>
}
```

### Alert Component Example

```typescript
import { Alert, AlertDescription } from '@/components/ui/alert'
import { validateSubscriptionCreateInput, ValidationError } from '@/lib/validation'

export function CreateSubscriptionForm() {
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (data: any) => {
    try {
      validateSubscriptionCreateInput(data)
      await apiPost('/api/subscriptions', data)
    } catch (error) {
      if (error instanceof ValidationError) {
        setError(error.message)
      }
    }
  }

  return (
    <>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <form onSubmit={handleSubmit}>{/* ... */}</form>
    </>
  )
}
```

---

## Performance Notes

- Validation runs synchronously (no network calls)
- Errors are thrown immediately on first validation failure
- All errors are collected and reported together
- No performance impact on form submission

---

## Consistency with Backend

These frontend validation messages match the backend validation in:
- `backend/src/schemas/subscription.ts` - Zod schemas
- `backend/src/services/gift-card-service.ts` - Gift card validation

This ensures users see consistent error messages whether validation fails on the frontend or backend.
