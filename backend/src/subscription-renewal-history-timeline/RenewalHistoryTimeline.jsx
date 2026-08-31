import { useState, useEffect, useCallback } from "react";

// ─── Types ─────────────────────────────────────────────────────────────────

const EVENT_TYPES = [
  "renewed",
  "failed",
  "cancelled",
  "paused",
  "reactivated",
  "reminder_sent",
];

const EVENT_META = {
  renewed: { icon: "✦", label: "Renewed", color: "#22c55e", bg: "#052e16" },
  failed: { icon: "✕", label: "Failed", color: "#ef4444", bg: "#2d0a0a" },
  cancelled: { icon: "◼", label: "Cancelled", color: "#f97316", bg: "#2c1006" },
  paused: { icon: "⏸", label: "Paused", color: "#a78bfa", bg: "#1e1030" },
  reactivated: {
    icon: "↺",
    label: "Reactivated",
    color: "#38bdf8",
    bg: "#0c1a2e",
  },
  reminder_sent: {
    icon: "◎",
    label: "Reminder Sent",
    color: "#fbbf24",
    bg: "#1f1700",
  },
};

function formatDate(iso) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAmount(amount, currency) {
  if (amount == null) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
  }).format(amount);
}

// ─── Mock fetch (replace with real fetch to your backend) ─────────────────

async function fetchHistory(
  subscriptionId,
  { page = 1, limit = 20, eventTypes, status } = {},
) {
  await new Promise((r) => setTimeout(r, 600));
  const allEvents = [
    {
      id: "e1",
      date: "2025-03-01T10:00:00Z",
      type: "renewed",
      status: "success",
      amount: 15.99,
      currency: "USD",
      paymentMethod: "stellar",
      transactionHash:
        "a3b1c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3",
      blockchainVerified: true,
      explorerUrl: "https://stellar.expert/explorer/public/tx/a3b1c4d5",
    },
    {
      id: "e2",
      date: "2025-02-08T09:00:00Z",
      type: "reminder_sent",
      channel: "email",
    },
    {
      id: "e3",
      date: "2025-02-01T10:00:00Z",
      type: "renewed",
      status: "success",
      amount: 15.99,
      currency: "USD",
      paymentMethod: "stellar",
      transactionHash:
        "b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5",
      blockchainVerified: true,
      explorerUrl: "https://stellar.expert/explorer/public/tx/b4c5d6e7",
    },
    {
      id: "e4",
      date: "2025-01-15T08:30:00Z",
      type: "failed",
      status: "failed",
      amount: 15.99,
      currency: "USD",
      paymentMethod: "stellar",
      notes: "Insufficient XLM for base reserve",
    },
    {
      id: "e5",
      date: "2025-01-08T09:00:00Z",
      type: "reminder_sent",
      channel: "email",
    },
    {
      id: "e6",
      date: "2025-01-01T10:00:00Z",
      type: "renewed",
      status: "success",
      amount: 12.99,
      currency: "USD",
      paymentMethod: "stellar",
      transactionHash:
        "c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
      blockchainVerified: true,
      explorerUrl: "https://stellar.expert/explorer/public/tx/c5d6e7f8",
    },
    {
      id: "e7",
      date: "2024-12-15T11:00:00Z",
      type: "paused",
      notes: "User requested pause until January",
    },
    { id: "e8", date: "2024-12-01T10:00:00Z", type: "reactivated" },
  ];

  const filtered = allEvents.filter((e) => {
    if (eventTypes?.length && !eventTypes.includes(e.type)) return false;
    if (status && e.status !== status) return false;
    return true;
  });

  const start = (page - 1) * limit;
  return {
    subscriptionId,
    history: filtered.slice(start, start + limit),
    total: filtered.length,
    page,
    limit,
    totalPages: Math.ceil(filtered.length / limit),
  };
}

// ─── Sub-components ────────────────────────────────────────────────────────

function FilterBar({ activeTypes, onToggle, statusFilter, onStatusChange }) {
  return (
    <div
      style={{
        display: "flex",
        gap: "8px",
        flexWrap: "wrap",
        alignItems: "center",
        marginBottom: "24px",
      }}
    >
      <span
        style={{
          color: "#6b7280",
          fontSize: "11px",
          fontFamily: "monospace",
          letterSpacing: "0.1em",
          marginRight: "4px",
        }}
      >
        FILTER
      </span>
      {EVENT_TYPES.map((type) => {
        const meta = EVENT_META[type];
        const active = activeTypes.includes(type);
        return (
          <button
            key={type}
            onClick={() => onToggle(type)}
            style={{
              padding: "4px 10px",
              borderRadius: "20px",
              border: "1px solid",
              borderColor: active ? meta.color : "#374151",
              background: active ? meta.bg : "transparent",
              color: active ? meta.color : "#9ca3af",
              fontSize: "11px",
              fontFamily: "monospace",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            {meta.icon} {meta.label}
          </button>
        );
      })}
      <select
        value={statusFilter}
        onChange={(e) => onStatusChange(e.target.value)}
        style={{
          marginLeft: "auto",
          background: "#111827",
          color: "#9ca3af",
          border: "1px solid #374151",
          borderRadius: "6px",
          padding: "4px 8px",
          fontSize: "12px",
          fontFamily: "monospace",
          cursor: "pointer",
        }}
      >
        <option value="">All statuses</option>
        <option value="success">Success</option>
        <option value="failed">Failed</option>
        <option value="pending">Pending</option>
      </select>
    </div>
  );
}

function TimelineEvent({ event, isLast }) {
  const [expanded, setExpanded] = useState(false);
  const meta = EVENT_META[event.type] || EVENT_META.renewed;
  const hasDetails =
    event.transactionHash ||
    event.notes ||
    event.channel ||
    event.paymentMethod;

  return (
    <div style={{ display: "flex", gap: "0", position: "relative" }}>
      {/* Connector line */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: "40px",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: "32px",
            height: "32px",
            borderRadius: "50%",
            background: meta.bg,
            border: `1.5px solid ${meta.color}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: meta.color,
            fontSize: "13px",
            flexShrink: 0,
            zIndex: 1,
            boxShadow: `0 0 12px ${meta.color}33`,
          }}
        >
          {meta.icon}
        </div>
        {!isLast && (
          <div
            style={{
              width: "1px",
              flexGrow: 1,
              background: "linear-gradient(#374151, transparent)",
              minHeight: "32px",
            }}
          />
        )}
      </div>

      {/* Card */}
      <div
        style={{
          flex: 1,
          marginLeft: "12px",
          marginBottom: isLast ? 0 : "20px",
          background: "#111827",
          border: "1px solid #1f2937",
          borderRadius: "10px",
          padding: "12px 16px",
          cursor: hasDetails ? "pointer" : "default",
          transition: "border-color 0.15s",
        }}
        onClick={() => hasDetails && setExpanded((e) => !e)}
        onMouseEnter={(e) => {
          if (hasDetails) e.currentTarget.style.borderColor = "#374151";
        }}
        onMouseLeave={(e) => {
          if (hasDetails) e.currentTarget.style.borderColor = "#1f2937";
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "8px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span
              style={{
                fontSize: "11px",
                fontFamily: "monospace",
                letterSpacing: "0.08em",
                color: meta.color,
                background: meta.bg,
                padding: "2px 8px",
                borderRadius: "4px",
              }}
            >
              {meta.label.toUpperCase()}
            </span>
            {event.status && (
              <span
                style={{
                  fontSize: "11px",
                  fontFamily: "monospace",
                  color:
                    event.status === "success"
                      ? "#22c55e"
                      : event.status === "failed"
                        ? "#ef4444"
                        : "#fbbf24",
                }}
              >
                {event.status}
              </span>
            )}
            {event.amount != null && (
              <span
                style={{
                  fontSize: "14px",
                  fontWeight: "600",
                  color: "#f9fafb",
                }}
              >
                {formatAmount(event.amount, event.currency)}
              </span>
            )}
          </div>
          <span
            style={{
              fontSize: "11px",
              color: "#6b7280",
              fontFamily: "monospace",
              whiteSpace: "nowrap",
            }}
          >
            {formatDate(event.date)}
          </span>
        </div>

        {/* Expanded details */}
        {expanded && (
          <div
            style={{
              marginTop: "12px",
              paddingTop: "12px",
              borderTop: "1px solid #1f2937",
            }}
          >
            {event.paymentMethod && (
              <Detail label="Method" value={event.paymentMethod} />
            )}
            {event.channel && <Detail label="Channel" value={event.channel} />}
            {event.transactionHash && (
              <Detail
                label="Tx Hash"
                value={
                  <span
                    style={{
                      fontFamily: "monospace",
                      fontSize: "11px",
                      color: "#9ca3af",
                      wordBreak: "break-all",
                    }}
                  >
                    {event.transactionHash}
                  </span>
                }
              />
            )}
            {event.blockchainVerified != null && (
              <Detail
                label="Verified"
                value={
                  event.blockchainVerified && event.explorerUrl ? (
                    <a
                      href={event.explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        padding: "2px 8px",
                        borderRadius: "4px",
                        background: "#052e16",
                        color: "#22c55e",
                        fontSize: "11px",
                        fontFamily: "monospace",
                        textDecoration: "none",
                        cursor: "pointer",
                      }}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`View transaction on StellarExpert`}
                    >
                      ✓ Blockchain Synced ↗
                    </a>
                  ) : (
                    <span
                      style={{
                        color: event.blockchainVerified ? "#22c55e" : "#ef4444",
                      }}
                    >
                      {event.blockchainVerified
                        ? "✓ On-chain confirmed"
                        : "✕ Unverified"}
                    </span>
                  )
                }
              />
            )}
            {event.notes && (
              <Detail
                label="Notes"
                value={
                  <span style={{ color: "#f87171", fontSize: "12px" }}>
                    {event.notes}
                  </span>
                }
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div
      style={{
        display: "flex",
        gap: "12px",
        alignItems: "flex-start",
        marginBottom: "6px",
      }}
    >
      <span
        style={{
          fontSize: "11px",
          color: "#6b7280",
          fontFamily: "monospace",
          minWidth: "64px",
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: "12px", color: "#d1d5db" }}>{value}</span>
    </div>
  );
}

function Skeleton() {
  return (
    <div>
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          style={{ display: "flex", gap: "12px", marginBottom: "20px" }}
        >
          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "50%",
              background: "#1f2937",
            }}
          />
          <div
            style={{
              flex: 1,
              height: "60px",
              borderRadius: "10px",
              background: "#111827",
              animation: "pulse 1.5s ease-in-out infinite",
            }}
          />
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────

export default function RenewalHistoryTimeline({
  subscriptionId = "sub-uuid-demo",
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTypes, setActiveTypes] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchHistory(subscriptionId, {
        page,
        limit: 20,
        eventTypes: activeTypes.length ? activeTypes : undefined,
        status: statusFilter || undefined,
      });
      setData(result);
    } finally {
      setLoading(false);
    }
  }, [subscriptionId, page, activeTypes, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleType = (type) => {
    setPage(1);
    setActiveTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  };

  const handleExport = async () => {
    setExporting(true);
    await new Promise((r) => setTimeout(r, 800));
    // In production: fetch `/api/subscriptions/${subscriptionId}/history/export`
    // and trigger download
    const mockCsv =
      "id,date,type,status,amount\ne1,2025-03-01,renewed,success,15.99\n";
    const blob = new Blob([mockCsv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `renewal-history-${subscriptionId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setExporting(false);
  };

  const stats = data
    ? {
        total: data.total,
        renewals: data.history.filter((e) => e.type === "renewed").length,
        failures: data.history.filter((e) => e.type === "failed").length,
      }
    : null;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#030712",
        color: "#f9fafb",
        fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
        padding: "0",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Syne:wght@600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: #030712; }
        ::-webkit-scrollbar-thumb { background: #1f2937; border-radius: 3px; }
      `}</style>

      <div
        style={{ maxWidth: "760px", margin: "0 auto", padding: "40px 24px" }}
      >
        {/* Header */}
        <div style={{ marginBottom: "32px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
            }}
          >
            <div>
              <p
                style={{
                  fontSize: "11px",
                  color: "#6b7280",
                  letterSpacing: "0.15em",
                  marginBottom: "6px",
                }}
              >
                SUBSCRIPTION · {subscriptionId}
              </p>
              <h1
                style={{
                  fontFamily: "'Syne', sans-serif",
                  fontSize: "26px",
                  fontWeight: "700",
                  color: "#f9fafb",
                }}
              >
                Renewal History
              </h1>
            </div>
            <button
              onClick={handleExport}
              disabled={exporting || !data}
              style={{
                padding: "8px 16px",
                background: "transparent",
                border: "1px solid #374151",
                borderRadius: "8px",
                color: "#9ca3af",
                fontFamily: "monospace",
                fontSize: "12px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                opacity: exporting ? 0.5 : 1,
                transition: "all 0.15s",
              }}
            >
              {exporting ? "Exporting…" : "↓ Export CSV"}
            </button>
          </div>

          {/* Stats strip */}
          {stats && (
            <div
              style={{
                display: "flex",
                gap: "24px",
                marginTop: "20px",
                padding: "14px 16px",
                background: "#0a0f1a",
                border: "1px solid #1f2937",
                borderRadius: "10px",
              }}
            >
              {[
                { label: "Total Events", value: stats.total, color: "#9ca3af" },
                {
                  label: "Successful Renewals",
                  value: stats.renewals,
                  color: "#22c55e",
                },
                { label: "Failed", value: stats.failures, color: "#ef4444" },
              ].map((s) => (
                <div key={s.label}>
                  <div
                    style={{
                      fontSize: "20px",
                      fontWeight: "600",
                      color: s.color,
                      fontFamily: "'Syne', sans-serif",
                    }}
                  >
                    {s.value}
                  </div>
                  <div
                    style={{
                      fontSize: "10px",
                      color: "#6b7280",
                      letterSpacing: "0.08em",
                    }}
                  >
                    {s.label.toUpperCase()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Filters */}
        <FilterBar
          activeTypes={activeTypes}
          onToggle={toggleType}
          statusFilter={statusFilter}
          onStatusChange={(v) => {
            setStatusFilter(v);
            setPage(1);
          }}
        />

        {/* Timeline */}
        <div style={{ animation: "fadeIn 0.3s ease" }}>
          {loading ? (
            <Skeleton />
          ) : !data?.history?.length ? (
            <div
              style={{
                textAlign: "center",
                padding: "48px 0",
                color: "#6b7280",
                border: "1px dashed #1f2937",
                borderRadius: "12px",
              }}
            >
              <div style={{ fontSize: "28px", marginBottom: "8px" }}>◌</div>
              <p style={{ fontSize: "13px" }}>
                No events match the current filters
              </p>
            </div>
          ) : (
            data.history.map((event, i) => (
              <TimelineEvent
                key={event.id}
                event={event}
                isLast={i === data.history.length - 1}
              />
            ))
          )}
        </div>

        {/* Pagination */}
        {data && data.totalPages > 1 && (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: "12px",
              marginTop: "28px",
            }}
          >
            <button
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
              style={{
                background: "transparent",
                border: "1px solid #374151",
                color: page === 1 ? "#374151" : "#9ca3af",
                padding: "6px 14px",
                borderRadius: "6px",
                cursor: page === 1 ? "not-allowed" : "pointer",
                fontFamily: "monospace",
                fontSize: "12px",
              }}
            >
              ← Prev
            </button>
            <span style={{ fontSize: "12px", color: "#6b7280" }}>
              {page} / {data.totalPages}
            </span>
            <button
              disabled={page === data.totalPages}
              onClick={() => setPage((p) => p + 1)}
              style={{
                background: "transparent",
                border: "1px solid #374151",
                color: page === data.totalPages ? "#374151" : "#9ca3af",
                padding: "6px 14px",
                borderRadius: "6px",
                cursor: page === data.totalPages ? "not-allowed" : "pointer",
                fontFamily: "monospace",
                fontSize: "12px",
              }}
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
