"use client"

import { useEffect, useState } from "react"
import { SessionManager } from "@/lib/security-utils"
import { Button } from "@syncro/ui"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@syncro/ui"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from 'next/navigation'

export function SessionTimeoutWarning() {
  const [showWarning, setShowWarning] = useState(false)
  const [timeLeft, setTimeLeft] = useState(0)
  const router = useRouter()

  useEffect(() => {
    const sessionManager = new SessionManager(
      30, // 30 minutes timeout
      async () => {
        const supabase = createClient()
        await supabase.auth.signOut()
        router.push("/auth/login?timeout=true")
      },
      () => {
        setShowWarning(true)
      }
    )

    // Update time left every second when warning is shown
    const interval = setInterval(() => {
      if (showWarning) {
        // Calculate remaining time (approximate)
        const remaining = 120000 // 2 minutes warning period
        setTimeLeft(Math.max(0, Math.floor(remaining / 1000)))
      }
    }, 1000)

    return () => {
      sessionManager.destroy()
      clearInterval(interval)
    }
  }, [showWarning, router])

  const handleExtend = () => {
    setShowWarning(false)
    // Session will be extended automatically by user activity
  }

  if (!showWarning) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Session Expiring Soon</CardTitle>
          <CardDescription>Your session will expire in {timeLeft} seconds due to inactivity.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleExtend} className="w-full">
            Continue Session
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
