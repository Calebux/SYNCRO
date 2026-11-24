# Validation Quick Reference Card

## Three Validation Functions

### 1. validateSubscriptionCreateInput(data)
```typescript
import { validateSubscriptionCreateInput, ValidationError } from '@/lib/validation'

try {
  validateSubscriptionCreateInput({
    name: 'Netflix',
    price: 15.99,
    billing_cycle: 'monthly'
  })
  // Validation passed, safe to call API
} catch (error) {
  if (error instanceof ValidationError) {
    console.log(error.message) // Show to user
  }
}
```

**Required Fields**: name, price, billing_cycle
**Optional Fields**: currency, renewal_url, website_url, logo_url, category, notes, is_trial, trial_end_date, trial_converts_to_price, status

---

### 2. validateSubscriptionUpdateInput(data)
```typescript
import { validateSubscriptionUpdateInput, ValidationError } from '@/lib/validation'

try {
  validateSubscriptionUpdateInput({
    price: 19.99,
    status: 'active'
  })
  // Validation passed, safe to call API
} catch (error) {
  if (error instanceof ValidationError) {
    console.log(error.message) // Show to user
  }
}
```

**All Fields Optional**: name, price, billing_cycle, currency, renewal_url, website_url, logo_url, category, notes, status, next_billing_date

---

### 3. validateGiftCardHash(hash)
```typescript
import { validateGiftCardHash, ValidationError } from '@/lib/validation'

try {
  validateGiftCardHash('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  // Validation passed, safe to call API
} catch (error) {
  if (error instanceof ValidationError) {
    console.log(error.message) // Show to user
  }
}
```

**Requirements**: 32-64 character hexadecimal string

---

## Validation Rules at a Glance

| Field | Type | Min | Max | Valid Values |
|-------|------|-----|-----|--------------|
| name | string | 1 | 100 | any |
| price | number | 0 | 100,000 | any |
| billing_cycle | enum | - | - | monthly, yearly, quarterly, weekly, annual |
| currency | string | - | 10 | any |
| renewal_url | URL | - | 2000 | http://, https:// |
| website_url | URL | - | 2000 | http://, https:// |
| logo_url | URL | - | 2000 | http://, https:// |
| category | string | - | 50 | any |
| notes | string | - | 5000 | any |
| status | enum | - | - | active, cancelled, expired, paused, trial |
| trial_end_date | datetime | - | - | ISO 8601 format |
| next_billing_date | datetime | - | - | ISO 8601 format |
| giftCardHash | hex | 32 | 64 | 0-9, a-f, A-F |

---

## Common Error Messages

```
Subscription name is required
Price must be a valid number
Price must be zero or positive
Billing cycle must be one of: monthly, yearly, quarterly, weekly, annual
Renewal URL must be a valid HTTP/HTTPS URL
Trial end date is required when trial is enabled
Gift card hash must contain only hexadecimal characters (0-9, a-f, A-F)
```

---

## Integration Pattern

```typescript
// 1. Import validation function
import { validateSubscriptionCreateInput, ValidationError } from '@/lib/validation'
import { apiPost } from '@/lib/api'

// 2. Validate before API call
try {
  validateSubscriptionCreateInput(formData)
  
  // 3. Make API request
  const response = await apiPost('/api/subscriptions', formData)
  
  // 4. Handle success
  showSuccessToast('Created!')
  
} catch (error) {
  // 5. Handle validation error
  if (error instanceof ValidationError) {
    showErrorToast(error.message)
  } else {
    // Handle API error
    showErrorToast('Server error')
  }
}
```

---

## Test Examples

```bash
# Run all validation tests
npm test -- __tests__/lib/validation.test.ts

# Run specific test suite
npm test -- __tests__/lib/validation.test.ts -t "validateSubscriptionCreateInput"

# Run with coverage
npm test:coverage -- __tests__/lib/validation.test.ts
```

---

## Files

| File | Purpose | Lines |
|------|---------|-------|
| `client/lib/validation.ts` | Validation functions | 406 |
| `client/__tests__/lib/validation.test.ts` | Test suite (150+ tests) | 757 |
| `VALIDATION_INTEGRATION_GUIDE.md` | Integration instructions | - |
| `VALIDATION_ERROR_EXAMPLES.md` | Error message examples | - |
| `ISSUE_90_IMPLEMENTATION_SUMMARY.md` | Implementation details | - |

---

## Key Points

✅ **Runs before API calls** - Catch errors early
✅ **Throws ValidationError** - Easy to catch and handle
✅ **User-friendly messages** - Clear what went wrong
✅ **Comprehensive tests** - 150+ test cases
✅ **No dependencies** - Pure TypeScript
✅ **Backward compatible** - Legacy functions preserved
✅ **Fast** - Synchronous, <1ms per validation

---

## Common Patterns

### React Hook Form Integration
```typescript
const handleSubmit = async (data: any) => {
  try {
    validateSubscriptionCreateInput(data)
    await apiPost('/api/subscriptions', data)
  } catch (error) {
    if (error instanceof ValidationError) {
      setError('root', { message: error.message })
    }
  }
}
```

### Toast Notification
```typescript
try {
  validateSubscriptionCreateInput(data)
  await apiPost('/api/subscriptions', data)
  toast({ title: 'Success', description: 'Created!' })
} catch (error) {
  if (error instanceof ValidationError) {
    toast({ title: 'Error', description: error.message, variant: 'destructive' })
  }
}
```

### Alert Component
```typescript
{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
```

---

## Troubleshooting

**Q: Validation passes but API fails?**
A: Backend has additional validation. Check `backend/src/schemas/subscription.ts`

**Q: Multiple errors shown?**
A: All validation errors are collected and shown together, separated by newlines

**Q: How to add new validation?**
A: Edit the validation function in `client/lib/validation.ts` and add test cases

**Q: Can I use Zod instead?**
A: Yes, but current implementation uses manual checks for consistency with backend

---

## Next Steps

1. ✅ Review this quick reference
2. ✅ Read `VALIDATION_INTEGRATION_GUIDE.md`
3. ✅ Integrate into forms
4. ✅ Run tests
5. ✅ Deploy

---

## Support

- Integration Guide: `VALIDATION_INTEGRATION_GUIDE.md`
- Error Examples: `VALIDATION_ERROR_EXAMPLES.md`
- Implementation Details: `ISSUE_90_IMPLEMENTATION_SUMMARY.md`
- Test Cases: `client/__tests__/lib/validation.test.ts`
