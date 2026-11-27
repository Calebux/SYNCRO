export function LoadingSpinner({ size = "md", darkMode = false }: { size?: "sm" | "md" | "lg"; darkMode?: boolean }) {
  const sizeClasses = {
    sm: "w-4 h-4 border-2",
    md: "w-6 h-6 border-2",
    lg: "w-8 h-8 border-3",
  }

  return (
    <div
      className={`${sizeClasses[size]} border-t-transparent ${darkMode ? "border-white" : "border-gray-900"} rounded-full animate-spin`}
    />
  )
}
