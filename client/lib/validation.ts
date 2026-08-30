import { isSafeHttpUrl, maskApiKey, validateEmail } from "@syncro/shared/security"

/**
 * Validates subscription creation input before sending to backend.
 * Runs BEFORE any Axios request to catch errors early.
 *
 * @param data - The subscription data to validate
 * @throws {ValidationError} If validation fails with descriptive error message
 * @returns {void} If validation passes
 *
 * @example
 * try {
 *   validateSubscriptionCreateInput(formData);
 *   await apiPost('/api/subscriptions', formData);
 * } catch (error) {
 *   showUserError(error.message);
 * }
 */
export function validateSubscriptionCreateInput(data: any): void {
  const errors: string[] = []

  // Name validation
  if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
    errors.push("Subscription name is required")
  } else if (data.name.length > 100) {
    errors.push("Subscription name must not exceed 100 characters")
  }

  // Price validation
  const price = Number.parseFloat(data.price)
  if (isNaN(price)) {
    errors.push("Price must be a valid number")
  } else if (price < 0) {
    errors.push("Price must be zero or positive")
  } else if (price > 100000) {
    errors.push("Price must not exceed $100,000")
  }

  // Billing cycle validation
  const validBillingCycles = ['monthly', 'yearly', 'quarterly', 'weekly', 'annual']
  if (!data.billing_cycle || !validBillingCycles.includes(data.billing_cycle)) {
    errors.push(`Billing cycle must be one of: ${validBillingCycles.join(', ')}`)
  }

  // Currency validation (optional but if provided, must be valid)
  if (data.currency) {
    if (typeof data.currency !== 'string' || data.currency.length > 10) {
      errors.push("Currency must be a valid code (max 10 characters)")
    }
  }

  // URL validations (optional)
  if (data.renewal_url) {
    if (!isValidUrl(data.renewal_url)) {
      errors.push("Renewal URL must be a valid HTTP/HTTPS URL")
    }
  }

  if (data.website_url) {
    if (!isValidUrl(data.website_url)) {
      errors.push("Website URL must be a valid HTTP/HTTPS URL")
    }
  }

  if (data.logo_url) {
    if (!isValidUrl(data.logo_url)) {
      errors.push("Logo URL must be a valid HTTP/HTTPS URL")
    }
  }

  // Category validation (optional)
  if (data.category && typeof data.category !== 'string') {
    errors.push("Category must be a text value")
  } else if (data.category && data.category.length > 50) {
    errors.push("Category must not exceed 50 characters")
  }

  // Notes validation (optional)
  if (data.notes && typeof data.notes !== 'string') {
    errors.push("Notes must be a text value")
  } else if (data.notes && data.notes.length > 5000) {
    errors.push("Notes must not exceed 5000 characters")
  }

  // Trial-related validations (optional)
  if (data.is_trial === true) {
    if (!data.trial_end_date) {
      errors.push("Trial end date is required when trial is enabled")
    } else if (!isValidDateTime(data.trial_end_date)) {
      errors.push("Trial end date must be a valid date and time")
    }

    if (data.trial_converts_to_price !== undefined) {
      const trialPrice = Number.parseFloat(data.trial_converts_to_price)
      if (isNaN(trialPrice) || trialPrice < 0) {
        errors.push("Trial conversion price must be zero or positive")
      }
    }
  }

  // Status validation (optional)
  if (data.status) {
    const validStatuses = ['active', 'cancelled', 'expired', 'paused', 'trial']
    if (!validStatuses.includes(data.status)) {
      errors.push(`Status must be one of: ${validStatuses.join(', ')}`)
    }
  }

  if (errors.length > 0) {
    throw new ValidationError(errors.join('\n'))
  }
}

/**
 * Validates subscription update input before sending to backend.
 * Runs BEFORE any Axios request to catch errors early.
 * All fields are optional for updates.
 *
 * @param data - The subscription update data to validate
 * @throws {ValidationError} If validation fails with descriptive error message
 * @returns {void} If validation passes
 *
 * @example
 * try {
 *   validateSubscriptionUpdateInput(updates);
 *   await apiPatch(`/api/subscriptions/${id}`, updates);
 * } catch (error) {
 *   showUserError(error.message);
 * }
 */
export function validateSubscriptionUpdateInput(data: any): void {
  const errors: string[] = []

  // Name validation (optional)
  if (data.name !== undefined) {
    if (typeof data.name !== 'string' || data.name.trim().length === 0) {
      errors.push("Subscription name must be a non-empty string")
    } else if (data.name.length > 100) {
      errors.push("Subscription name must not exceed 100 characters")
    }
  }

  // Price validation (optional)
  if (data.price !== undefined) {
    const price = Number.parseFloat(data.price)
    if (isNaN(price)) {
      errors.push("Price must be a valid number")
    } else if (price < 0) {
      errors.push("Price must be zero or positive")
    } else if (price > 100000) {
      errors.push("Price must not exceed $100,000")
    }
  }

  // Billing cycle validation (optional)
  if (data.billing_cycle !== undefined) {
    const validBillingCycles = ['monthly', 'yearly', 'quarterly', 'weekly', 'annual']
    if (!validBillingCycles.includes(data.billing_cycle)) {
      errors.push(`Billing cycle must be one of: ${validBillingCycles.join(', ')}`)
    }
  }

  // Currency validation (optional)
  if (data.currency !== undefined) {
    if (typeof data.currency !== 'string' || data.currency.length > 10) {
      errors.push("Currency must be a valid code (max 10 characters)")
    }
  }

  // URL validations (optional)
  if (data.renewal_url !== undefined) {
    if (!isValidUrl(data.renewal_url)) {
      errors.push("Renewal URL must be a valid HTTP/HTTPS URL")
    }
  }

  if (data.website_url !== undefined) {
    if (!isValidUrl(data.website_url)) {
      errors.push("Website URL must be a valid HTTP/HTTPS URL")
    }
  }

  if (data.logo_url !== undefined) {
    if (!isValidUrl(data.logo_url)) {
      errors.push("Logo URL must be a valid HTTP/HTTPS URL")
    }
  }

  // Category validation (optional)
  if (data.category !== undefined) {
    if (typeof data.category !== 'string') {
      errors.push("Category must be a text value")
    } else if (data.category.length > 50) {
      errors.push("Category must not exceed 50 characters")
    }
  }

  // Notes validation (optional)
  if (data.notes !== undefined) {
    if (typeof data.notes !== 'string') {
      errors.push("Notes must be a text value")
    } else if (data.notes.length > 5000) {
      errors.push("Notes must not exceed 5000 characters")
    }
  }

  // Status validation (optional)
  if (data.status !== undefined) {
    const validStatuses = ['active', 'cancelled', 'expired', 'paused', 'trial']
    if (!validStatuses.includes(data.status)) {
      errors.push(`Status must be one of: ${validStatuses.join(', ')}`)
    }
  }

  // Next billing date validation (optional)
  if (data.next_billing_date !== undefined) {
    if (!isValidDateTime(data.next_billing_date)) {
      errors.push("Next billing date must be a valid date and time")
    }
  }

  if (errors.length > 0) {
    throw new ValidationError(errors.join('\n'))
  }
}

/**
 * Validates gift card hash format before sending to backend.
 * Runs BEFORE any Axios request to catch errors early.
 *
 * @param hash - The gift card hash to validate
 * @throws {ValidationError} If validation fails with descriptive error message
 * @returns {void} If validation passes
 *
 * @example
 * try {
 *   validateGiftCardHash(hashValue);
 *   await apiPost(`/api/subscriptions/${id}/gift-card`, { giftCardHash: hashValue, provider });
 * } catch (error) {
 *   showUserError(error.message);
 * }
 */
export function validateGiftCardHash(hash: string): void {
  const errors: string[] = []

  // Type check
  if (typeof hash !== 'string') {
    errors.push("Gift card hash must be a text value")
  } else if (hash.trim().length === 0) {
    errors.push("Gift card hash is required")
  } else if (hash.length < 32) {
    errors.push("Gift card hash must be at least 32 characters")
  } else if (hash.length > 64) {
    errors.push("Gift card hash must not exceed 64 characters")
  } else if (!/^[a-fA-F0-9]+$/.test(hash)) {
    errors.push("Gift card hash must contain only hexadecimal characters (0-9, a-f, A-F)")
  }

  if (errors.length > 0) {
    throw new ValidationError(errors.join('\n'))
  }
}

/**
 * Legacy validation function - kept for backward compatibility.
 * Use validateSubscriptionCreateInput() for new code.
 */
export const validateSubscriptionData = (data: any) => {
  const errors: Record<string, string> = {}

  // Name validation
  if (!data.name || data.name.trim().length === 0) {
    errors.name = "Subscription name is required"
  } else if (data.name.length > 100) {
    errors.name = "Subscription name must be less than 100 characters"
  }

  // Price validation
  const price = Number.parseFloat(data.price)
  if (isNaN(price) || price <= 0) {
    errors.price = "Price must be greater than $0"
  } else if (price > 10000) {
    errors.price = "Price must be less than $10,000"
  }

  // Date validation (renewal date)
  if (data.renewsIn !== undefined && data.renewsIn !== null) {
    const renewsIn = Number.parseInt(data.renewsIn)
    if (isNaN(renewsIn) || renewsIn < 0) {
      errors.renewsIn = "Days until renewal must be 0 or greater"
    } else if (renewsIn > 365) {
      errors.renewsIn = "Days until renewal must be less than 365"
    }
  }

  // Email validation
  if (data.email) {
    if (!validateEmail(data.email)) {
      errors.email = "Invalid email format"
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  }
}

export const validateAPIKey = (provider: string, apiKey: string) => {
  const errors: string[] = []

  if (!apiKey || apiKey.trim().length === 0) {
    errors.push("API key is required")
    return { isValid: false, errors }
  }

  // Provider-specific validation
  switch (provider.toLowerCase()) {
    case "openai":
    case "chatgpt":
      if (!apiKey.startsWith("sk-")) {
        errors.push("OpenAI API keys must start with 'sk-'")
      }
      if (apiKey.length < 20) {
        errors.push("OpenAI API key appears to be too short")
      }
      break
    case "anthropic":
    case "claude":
      if (!apiKey.startsWith("sk-ant-")) {
        errors.push("Anthropic API keys must start with 'sk-ant-'")
      }
      break
    case "google":
    case "gemini":
      if (apiKey.length < 30) {
        errors.push("Google API key appears to be too short")
      }
      break
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}

export const maskAPIKey = (apiKey: string) => {
  return maskApiKey(apiKey)
}

// ─── Helper Functions ───────────────────────────────────────────────────────

/**
 * Validates if a string is a valid HTTP/HTTPS URL.
 * @param url - The URL string to validate
 * @returns true if valid, false otherwise
 */
function isValidUrl(url: string): boolean {
  return isSafeHttpUrl(url)
}

/**
 * Validates if a string is a valid ISO 8601 datetime.
 * @param dateTime - The datetime string to validate
 * @returns true if valid, false otherwise
 */
function isValidDateTime(dateTime: string): boolean {
  if (typeof dateTime !== 'string') {
    return false
  }

  // ISO 8601 datetime pattern with optional timezone
  const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})?$/

  if (!iso8601Regex.test(dateTime)) {
    return false
  }

  // Verify it's a valid date
  const date = new Date(dateTime)
  return !isNaN(date.getTime())
}

// ─── Custom Error Class ─────────────────────────────────────────────────────

/**
 * Custom error class for validation failures.
 * Provides clear, user-friendly error messages.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
    Object.setPrototypeOf(this, ValidationError.prototype)
  }
}
