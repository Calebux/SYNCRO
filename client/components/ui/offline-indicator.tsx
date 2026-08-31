"use client"

import { useState, useEffect } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { WifiOff } from "lucide-react"

interface OfflineIndicatorProps {
  show: boolean
  pendingMutationsCount?: number
}

export function OfflineIndicator({ show, pendingMutationsCount = 0 }: OfflineIndicatorProps) {
  const [visible, setVisible] = useState(show)

  useEffect(() => {
    setVisible(show)
  }, [show])

  if (!visible && pendingMutationsCount === 0) return null

  return (
    <div className="sticky top-0 z-50 bg-amber-50 border-b border-amber-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
        <Alert className="border-amber-200 bg-amber-50 text-amber-900">
          <WifiOff className="h-4 w-4 text-amber-600" />
          <AlertTitle className="text-amber-900 font-medium">
            You&apos;re offline
          </AlertTitle>
          <AlertDescription className="text-amber-700">
            {pendingMutationsCount > 0
              ? `${pendingMutationsCount} change${pendingMutationsCount !== 1 ? "s" : ""} pending sync. Changes will sync when you reconnect.`
              : "Viewing cached data. Connect to the internet for the latest information."
            }
          </AlertDescription>
        </Alert>
      </div>
    </div>
  )
}