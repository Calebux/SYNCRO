import { LoadingSpinner } from "@syncro/ui";

export default function Loading() {
  return (
    <div className="min-h-screen bg-[#F9F6F2] dark:bg-[#1E2A35] flex items-center justify-center">
      <LoadingSpinner size="lg" darkMode={false} />
    </div>
  );
}

