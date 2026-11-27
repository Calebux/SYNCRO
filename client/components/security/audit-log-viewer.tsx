"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { auditLogger, type AuditLogEntry } from "@/lib/audit-log"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, VirtualizedList } from "@syncro/ui"

interface AuditLogViewerProps {
  userId: string
  maxHeight?: number
}

const ITEM_HEIGHT = 64 // Approximate height of each audit log item

export function AuditLogViewer({ userId, maxHeight = 400 }: AuditLogViewerProps) {
  const [allLogs, setAllLogs] = useState<AuditLogEntry[]>([])
  const [filter, setFilter] = useState("")

  useEffect(() => {
    const logs = auditLogger.getLogs({ userId })
    setAllLogs(logs)
  }, [userId])

  const filteredLogs = useMemo(() => {
    return allLogs.filter(
      (log) =>
        log.action.toLowerCase().includes(filter.toLowerCase()) ||
        log.resource.toLowerCase().includes(filter.toLowerCase()),
    )
  }, [allLogs, filter])

  const renderLog = useCallback((log: AuditLogEntry) => (
    <div className="flex items-start gap-3 p-3 border rounded-lg text-sm border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors">
      <div className="flex-1">
        <p className="font-medium text-gray-900 dark:text-white">
          {log.action.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
        </p>
        <p className="text-xs text-gray-600 dark:text-gray-400">
          {log.resource} {log.resourceId && `(${log.resourceId.slice(0, 8)}...)`}
        </p>
        {log.details && (
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
            {typeof log.details === "string" ? log.details : JSON.stringify(log.details).slice(0, 50)}
          </p>
        )}
        <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">
          {new Date(log.timestamp).toLocaleString()}
        </p>
      </div>
    </div>
  ), [])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity Log</CardTitle>
        <CardDescription>View your recent account activity</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="audit-filter">Filter</Label>
          <Input
            id="audit-filter"
            placeholder="Search actions or resources..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-live="polite"
            aria-label={`Search audit log. ${filteredLogs.length} results`}
          />
        </div>

        {filteredLogs.length === 0 ? (
          <div
            role="status"
            className="text-sm text-muted-foreground text-center py-8"
          >
            No activity found
          </div>
        ) : (
          <VirtualizedList
            items={filteredLogs}
            itemHeight={ITEM_HEIGHT}
            containerHeight={maxHeight}
            renderItem={(item) => renderLog(item)}
            ariaLabel={`Audit log with ${filteredLogs.length} entries`}
            role="list"
          />
        )}
      </CardContent>
    </Card>
  )
}
