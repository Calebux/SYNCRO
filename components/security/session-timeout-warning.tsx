"use client"

import { useEffect, useState } from "react"
import { SessionManager } from "@/lib/security/session"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from 'next/navigation'

export function SessionTimeoutWarning() {
  const [showWarning, setShowWarning] = useState(false)
  const [timeLeft, setTimeLeft] = useState(0)
  const router = useRouter()

  useEffect(() => {
    const sessionManager = new SessionManager({
      onWarning: () => {
        setShowWarning(true)
      },
      onTimeout: async () => {
        const supabase = createClient()
        await supabase.auth.signOut()
        router.push("/auth/login?timeout=true")
      },
    })

    // Update time left every second when warning is shown
    const interval = setInterval(() => {
      if (showWarning) {
        const remaining = sessionManager.getTimeUntilTimeout()
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
