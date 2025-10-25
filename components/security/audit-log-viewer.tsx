"use client"

import { useState, useEffect } from "react"
import { auditLogger, type AuditLogEntry } from "@/lib/audit-log"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function AuditLogViewer({ userId }: { userId: string }) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([])
  const [filter, setFilter] = useState("")

  useEffect(() => {
    const allLogs = auditLogger.getLogs({ userId })
    setLogs(allLogs)
  }, [userId])

  const filteredLogs = logs.filter(
    (log) =>
      log.action.toLowerCase().includes(filter.toLowerCase()) ||
      log.resource.toLowerCase().includes(filter.toLowerCase()),
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity Log</CardTitle>
        <CardDescription>View your recent account activity</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="filter">Filter</Label>
          <Input
            id="filter"
            placeholder="Search actions..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {filteredLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No activity found</p>
          ) : (
            filteredLogs.map((log) => (
              <div key={log.id} className="flex items-start gap-3 p-3 border rounded-lg text-sm">
                <div className="flex-1">
                  <p className="font-medium">
                    {log.action.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                  </p>
                  <p className="text-muted-foreground">
                    {log.resource} {log.resourceId && `(${log.resourceId.slice(0, 8)}...)`}
                  </p>
                  {log.details && <p className="text-xs text-muted-foreground mt-1">{JSON.stringify(log.details)}</p>}
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(log.timestamp).toLocaleString()}
                </span>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  )
}
