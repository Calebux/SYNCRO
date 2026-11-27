# Frontend Validation Integration Guide

## Overview

This guide explains how to integrate the three new validation functions into the SYNCRO frontend to catch invalid payloads **before** they reach the backend.

**Issue #90 Implementation**: Missing validation methods for subscription creation, updates, and gift card hashing.

## Validation Functions

### 1. `validateSubscriptionCreateInput(data)`

Validates subscription creation data before sending to the backend.

**Location**: `client/lib/validation.ts`

**Throws**: `ValidationError` with descriptive message if validation fails

**Usage**:
```typescript
import { validateSubscriptionCreateInput, ValidationError } from '@/lib/validation'

try {
  const formData = {
    name: 'Netflix',
    price: 15.99,
    billing_cycle: 'monthly',
    currency: 'USD',
    renewal_url: 'https://netflix.com/renew',
  }
  
  // Validate BEFORE making the API call
  validateSubscriptionCreateInput(formData)
  
  // If validation passes, make the request
  const response = await apiPost('/api/subscriptions', formData)
  
} catch (error) {
  if (error instanceof ValidationError) {
    // Show user-friendly error message
    showErrorToast(error.message)
  }
}
```

**Validation Rules**:
- `name`: Required, 1-100 characters
- `price`: Required, 0-100,000
- `billing_cycle`: Required, one of: `monthly`, `yearly`, `quarterly`, `weekly`, `annual`
- `currency`: Optional, max 10 characters
- `renewal_url`: Optional, must be valid HTTP/HTTPS URL
- `website_url`: Optional, must be valid HTTP/HTTPS URL
- `logo_url`: Optional, must be valid HTTP/HTTPS URL
- `category`: Optional, max 50 characters
- `notes`: Optional, max 5000 characters
- `is_trial`: Optional boolean
- `trial_end_date`: Required if `is_trial=true`, must be valid ISO 8601 datetime
- `trial_converts_to_price`: Optional, must be 0 or positive
- `status`: Optional, one of: `active`, `cancelled`, `expired`, `paused`, `trial`

**Error Messages**:
```
Subscription name is required
Subscription name must not exceed 100 characters
Price must be a valid number
Price must be zero or positive
Price must not exceed $100,000
Billing cycle must be one of: monthly, yearly, quarterly, weekly, annual
Renewal URL must be a valid HTTP/HTTPS URL
Trial end date is required when trial is enabled
Trial end date must be a valid date and time
```

---

### 2. `validateSubscriptionUpdateInput(data)`

Validates subscription update data before sending to the backend. All fields are optional.

**Location**: `client/lib/validation.ts`

**Throws**: `ValidationError` with descriptive message if validation fails

**Usage**:
```typescript
import { validateSubscriptionUpdateInput, ValidationError } from '@/lib/validation'

try {
  const updates = {
    name: 'Netflix Premium',
    price: 19.99,
    status: 'active',
  }
  
  // Validate BEFORE making the API call
  validateSubscriptionUpdateInput(updates)
  
  // If validation passes, make the request
  const response = await apiPatch(`/api/subscriptions/${subscriptionId}`, updates)
  
} catch (error) {
  if (error instanceof ValidationError) {
    showErrorToast(error.message)
  }
}
```

**Validation Rules** (all optional):
- `name`: If provided, 1-100 characters
- `price`: If provided, 0-100,000
- `billing_cycle`: If provided, one of: `monthly`, `yearly`, `quarterly`, `weekly`, `annual`
- `currency`: If provided, max 10 characters
- `renewal_url`: If provided, must be valid HTTP/HTTPS URL
- `website_url`: If provided, must be valid HTTP/HTTPS URL
- `logo_url`: If provided, must be valid HTTP/HTTPS URL
- `category`: If provided, max 50 characters
- `notes`: If provided, max 5000 characters
- `status`: If provided, one of: `active`, `cancelled`, `expired`, `paused`, `trial`
- `next_billing_date`: If provided, must be valid ISO 8601 datetime

---

### 3. `validateGiftCardHash(hash)`

Validates gift card hash format before sending to the backend.

**Location**: `client/lib/validation.ts`

**Throws**: `ValidationError` with descriptive message if validation fails

**Usage**:
```typescript
import { validateGiftCardHash, ValidationError } from '@/lib/validation'

try {
  const giftCardHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  const provider = 'Amazon'
  
  // Validate BEFORE making the API call
  validateGiftCardHash(giftCardHash)
  
  // If validation passes, make the request
  const response = await apiPost(
    `/api/subscriptions/${subscriptionId}/gift-card`,
    { giftCardHash, provider }
  )
  
} catch (error) {
  if (error instanceof ValidationError) {
    showErrorToast(error.message)
  }
}
```

**Validation Rules**:
- Must be a string
- Must be 32-64 characters long
- Must contain only hexadecimal characters (0-9, a-f, A-F)
- Supports SHA-256 and similar hash formats

**Error Messages**:
```
Gift card hash must be a text value
Gift card hash is required
Gift card hash must be at least 32 characters
Gift card hash must not exceed 64 characters
Gift card hash must contain only hexadecimal characters (0-9, a-f, A-F)
```

---

## Integration Points

### 1. Subscription Creation Form

**File**: `client/app/subscriptions/create/page.tsx` (or similar)

```typescript
import { validateSubscriptionCreateInput, ValidationError } from '@/lib/validation'
import { apiPost } from '@/lib/api'

export default function CreateSubscriptionPage() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (formData: any) => {
    setError(null)
    setIsLoading(true)

    try {
      // Validate BEFORE API call
      validateSubscriptionCreateInput(formData)

      // Make API request
      const response = await apiPost('/api/subscriptions', formData)
      
      // Success handling
      showSuccessToast('Subscription created successfully')
      router.push('/subscriptions')
      
    } catch (err) {
      if (err instanceof ValidationError) {
        // Show validation errors to user
        setError(err.message)
      } else {
        // Handle API errors
        setError('Failed to create subscription')
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <ErrorAlert message={error} />}
      {/* Form fields */}
    </form>
  )
}
```

### 2. Subscription Update Form

**File**: `client/app/subscriptions/[id]/edit/page.tsx` (or similar)

```typescript
import { validateSubscriptionUpdateInput, ValidationError } from '@/lib/validation'
import { apiPatch } from '@/lib/api'

export default function EditSubscriptionPage({ params }: { params: { id: string } }) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (updates: any) => {
    setError(null)
    setIsLoading(true)

    try {
      // Validate BEFORE API call
      validateSubscriptionUpdateInput(updates)

      // Make API request
      const response = await apiPatch(`/api/subscriptions/${params.id}`, updates)
      
      // Success handling
      showSuccessToast('Subscription updated successfully')
      
    } catch (err) {
      if (err instanceof ValidationError) {
        setError(err.message)
      } else {
        setError('Failed to update subscription')
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <ErrorAlert message={error} />}
      {/* Form fields */}
    </form>
  )
}
```

### 3. Gift Card Attachment

**File**: `client/app/subscriptions/[id]/gift-card/page.tsx` (or similar)

```typescript
import { validateGiftCardHash, ValidationError } from '@/lib/validation'
import { apiPost } from '@/lib/api'

export default function AttachGiftCardPage({ params }: { params: { id: string } }) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleAttachGiftCard = async (giftCardHash: string, provider: string) => {
    setError(null)
    setIsLoading(true)

    try {
      // Validate BEFORE API call
      validateGiftCardHash(giftCardHash)

      // Make API request
      const response = await apiPost(
        `/api/subscriptions/${params.id}/gift-card`,
        { giftCardHash, provider }
      )
      
      // Success handling
      showSuccessToast('Gift card attached successfully')
      
    } catch (err) {
      if (err instanceof ValidationError) {
        setError(err.message)
      } else {
        setError('Failed to attach gift card')
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div>
      {error && <ErrorAlert message={error} />}
      {/* Form fields */}
    </div>
  )
}
```

---

## Validation Error Handling

### Custom Error Class

All validation functions throw a `ValidationError` which extends the native `Error` class:

```typescript
export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}
```

### Error Detection Pattern

```typescript
try {
  validateSubscriptionCreateInput(data)
  await apiPost('/api/subscriptions', data)
} catch (error) {
  if (error instanceof ValidationError) {
    // Frontend validation failed - show user-friendly message
    console.log('Validation error:', error.message)
    showErrorToast(error.message)
  } else if (error instanceof AxiosError) {
    // Backend validation failed or API error
    console.log('API error:', error.response?.data)
    showErrorToast('Server error: ' + error.response?.data?.message)
  } else {
    // Unknown error
    console.error('Unexpected error:', error)
    showErrorToast('An unexpected error occurred')
  }
}
```

---

## Benefits

1. **Early Error Detection**: Catch invalid data before network requests
2. **Better UX**: Users see validation errors immediately without waiting for backend response
3. **Reduced Backend Load**: Invalid requests never reach the server
4. **Security**: Prevents malformed payloads from reaching the API
5. **Consistent Validation**: Frontend and backend use same validation rules
6. **Clear Error Messages**: Users understand exactly what went wrong

---

## Testing

Comprehensive test suite included in `client/__tests__/lib/validation.test.ts`:

- **Valid input tests**: Ensure correct data passes validation
- **Invalid input tests**: Verify all validation rules are enforced
- **Edge case tests**: Boundary conditions and special cases
- **Error message tests**: Confirm user-friendly error messages

Run tests with:
```bash
npm test -- __tests__/lib/validation.test.ts
```

---

## Adding New Validations

To add validation for new fields:

1. **Update the validation function** in `client/lib/validation.ts`
2. **Add validation rules** following the existing pattern
3. **Add test cases** in `client/__tests__/lib/validation.test.ts`
4. **Update this guide** with new validation rules

Example:
```typescript
// In validateSubscriptionCreateInput()
if (data.newField) {
  if (typeof data.newField !== 'string') {
    errors.push("New field must be a text value")
  } else if (data.newField.length > 100) {
    errors.push("New field must not exceed 100 characters")
  }
}
```

---

## Backward Compatibility

The legacy `validateSubscriptionData()` function is preserved for backward compatibility. New code should use:
- `validateSubscriptionCreateInput()` for creation
- `validateSubscriptionUpdateInput()` for updates
- `validateGiftCardHash()` for gift cards

---

## Files Modified/Created

- ✅ `client/lib/validation.ts` - Enhanced with three new validation functions
- ✅ `client/__tests__/lib/validation.test.ts` - Comprehensive test suite (150+ test cases)
- ✅ `VALIDATION_INTEGRATION_GUIDE.md` - This integration guide

---

## Next Steps

1. Integrate validation into subscription creation form
2. Integrate validation into subscription update form
3. Integrate validation into gift card attachment flow
4. Run test suite to verify all validations work
5. Update error handling in API interceptors if needed
6. Deploy and monitor for validation errors in production

---

## Support

For questions or issues with validation:
1. Check the test cases in `client/__tests__/lib/validation.test.ts`
2. Review error messages in the validation functions
3. Refer to the integration examples above
4. Check the backend schemas in `backend/src/schemas/subscription.ts` for consistency
