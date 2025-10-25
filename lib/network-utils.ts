export async function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries = 3, initialDelay = 1000): Promise<T> {
  let lastError: Error

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error

      // Don't retry on client errors (4xx)
      if (error instanceof Response && error.status >= 400 && error.status < 500) {
        throw error
      }

      if (i < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, i)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError!
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    // Network errors
    if (error.message.includes("fetch")) {
      return "Network connection failed. Please check your internet connection and try again."
    }

    // Timeout errors
    if (error.message.includes("timeout")) {
      return "Request timed out. The server took too long to respond."
    }

    return error.message
  }

  if (typeof error === "string") {
    return error
  }

  return "An unexpected error occurred. Please try again."
}

export function isOnline(): boolean {
  return typeof navigator !== "undefined" ? navigator.onLine : true
}
