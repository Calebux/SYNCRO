"use client"

interface EmptyStateProps {
  icon: string
  title: string
  description: string
  action?: {
    label: string
    onClick: () => void
  }
  darkMode?: boolean
}

export function EmptyState({ icon, title, description, action, darkMode }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4">
      <div className="text-6xl mb-4">{icon}</div>
      <h3 className={`text-xl font-bold ${darkMode ? "text-white" : "text-gray-900"} mb-2 text-center`}>{title}</h3>
      <p className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-600"} mb-6 text-center max-w-md`}>
        {description}
      </p>
      {action && (
        <button
          onClick={action.onClick}
          className="bg-[#FFD166] text-[#1E2A35] px-6 py-3 rounded-lg font-semibold hover:bg-[#FFD166]/90 transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
