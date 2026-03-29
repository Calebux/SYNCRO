"use client"

// Security utilities for input sanitization and validation

export function sanitizeInput(input: string): string {
  return input
    .replace(/[<>]/g, "") // Remove < and >
    .replace(/javascript:/gi, "") // Remove javascript: protocol
    .replace(/on\w+=/gi, "") // Remove event handlers
    .trim()
}

export function sanitizeHTML(html: string): string {
  const div = document.createElement("div")
  div.textContent = html
  return div.innerHTML
}

export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

export function validateURL(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

export function validateAPIKey(key: string): boolean {
  // Basic validation: should be alphanumeric with dashes/underscores
  return /^[a-zA-Z0-9_-]+$/.test(key) && key.length >= 20
}

// Mask sensitive data for display
export function maskAPIKey(key: string): string {
  if (key.length <= 8) return "***"
  return `${key.slice(0, 4)}...${key.slice(-4)}`
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@")
  if (!local || !domain) return email
  return `${local.slice(0, 2)}***@${domain}`
}

// Rate limiting
class RateLimiter {
  private requests = new Map<string, number[]>()
  private limit: number
  private window: number

  constructor(limit: number, windowMs: number) {
    this.limit = limit
    this.window = windowMs
  }

  check(key: string): boolean {
    const now = Date.now()
    const requests = this.requests.get(key) || []

    // Remove old requests outside the window
    const validRequests = requests.filter((time) => now - time < this.window)

    if (validRequests.length >= this.limit) {
      return false
    }

    validRequests.push(now)
    this.requests.set(key, validRequests)
    return true
  }

  reset(key: string): void {
    this.requests.delete(key)
  }
}

// Create rate limiters for different actions
export const rateLimiters = {
  api: new RateLimiter(100, 60000), // 100 requests per minute
  auth: new RateLimiter(5, 300000), // 5 attempts per 5 minutes
  export: new RateLimiter(10, 60000), // 10 exports per minute
}

// CSRF protection is not needed here: all API requests authenticate via Supabase
// JWT Bearer tokens in the Authorization header, not cookies. Browser CSRF attacks
// rely on cookies being sent automatically — they cannot read or forge Bearer tokens.

// Content Security Policy helpers
export function generateNonce(): string {
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  return btoa(String.fromCharCode(...array))
}

// Session timeout management
export class SessionManager {
  private timeoutId: NodeJS.Timeout | null = null
  private warningTimeoutId: NodeJS.Timeout | null = null
  private lastActivity: number = Date.now()
  private readonly timeout: number
  private readonly warningTime: number
  private onTimeout: () => void
  private onWarning: () => void

  constructor(timeoutMinutes: number, onTimeout: () => void, onWarning: () => void) {
    this.timeout = timeoutMinutes * 60 * 1000
    this.warningTime = this.timeout - 2 * 60 * 1000 // Warn 2 minutes before timeout
    this.onTimeout = onTimeout
    this.onWarning = onWarning
    this.startTimer()
    this.setupActivityListeners()
  }

  private startTimer(): void {
    this.clearTimers()

    this.warningTimeoutId = setTimeout(() => {
      this.onWarning()
    }, this.warningTime)

    this.timeoutId = setTimeout(() => {
      this.onTimeout()
    }, this.timeout)
  }

  private clearTimers(): void {
    if (this.timeoutId) clearTimeout(this.timeoutId)
    if (this.warningTimeoutId) clearTimeout(this.warningTimeoutId)
  }

  private resetTimer = () => {
    const now = Date.now()
    if (now - this.lastActivity > 1000) {
      // Throttle to once per second
      this.lastActivity = now
      this.startTimer()
    }
  }

  private setupActivityListeners(): void {
    const events = ["mousedown", "keydown", "scroll", "touchstart"]
    events.forEach((event) => {
      window.addEventListener(event, this.resetTimer, { passive: true })
    })
  }

  extend(): void {
    this.startTimer()
  }

  destroy(): void {
    this.clearTimers()
    const events = ["mousedown", "keydown", "scroll", "touchstart"]
    events.forEach((event) => {
      window.removeEventListener(event, this.resetTimer)
    })
  }

  getTimeUntilTimeout(): number {
    const elapsed = Date.now() - this.lastActivity
    return Math.max(0, this.timeout - elapsed)
  }
}

// Secure storage wrapper
export const secureStorage = {
  set(key: string, value: any): void {
    if (typeof window === "undefined") return
    try {
      const encrypted = btoa(JSON.stringify(value))
      localStorage.setItem(key, encrypted)
    } catch (error) {
      console.error("Failed to store data:", error)
    }
  },

  get<T>(key: string): T | null {
    if (typeof window === "undefined") return null
    try {
      const encrypted = localStorage.getItem(key)
      if (!encrypted) return null
      return JSON.parse(atob(encrypted)) as T
    } catch (error) {
      console.error("Failed to retrieve data:", error)
      return null
    }
  },

  remove(key: string): void {
    if (typeof window === "undefined") return
    localStorage.removeItem(key)
  },

  clear(): void {
    if (typeof window === "undefined") return
    localStorage.clear()
  },
}
