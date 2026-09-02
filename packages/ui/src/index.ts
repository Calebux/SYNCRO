/**
 * @syncro/ui — SYNCRO design-system primitives.
 *
 * This package is the single source of truth for the app's shared UI
 * primitives. Import everything from the package entry point:
 *
 *   import { Button, Card, Input, cn } from "@syncro/ui";
 *
 * Deep imports past this entry point are banned by lint
 * (`no-restricted-imports` in `client/.eslintrc.cjs`). If a primitive you
 * need is missing, add it to `src/components/` and re-export it here — do
 * not import from `@syncro/ui/src/...` directly.
 */

export { cn } from "./lib/cn";

export { Alert, AlertTitle, AlertDescription } from "./components/alert";
export {
  announcePolite,
  announceAssertive,
  AriaLiveAnnouncer,
} from "./components/aria-live-announcer";
export { Badge, badgeVariants } from "./components/badge";
export type { BadgeProps } from "./components/badge";
export { Button, buttonVariants } from "./components/button";
export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
} from "./components/card";
export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "./components/command";
export { ConfirmationDialog } from "./components/confirmation-dialog";
export { EmptyState } from "./components/empty-state";
export { ErrorBoundary } from "./components/error-boundary";
export { Input } from "./components/input";
export { Label } from "./components/label";
export { LoadingSpinner } from "./components/loading-spinner";
export { NotesEditor } from "./components/notes-editor";
export { Progress } from "./components/progress";
export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
} from "./components/select";
export { Skeleton } from "./components/skeleton";
export { StatusBadge, normalizeStatus } from "./components/status-badge";
export type { BadgeStatus } from "./components/status-badge";
export { Switch } from "./components/switch";
export {
  Toast,
  ToastContainer,
  ToastProvider,
  useToast,
  setGlobalToastHandler,
  showToast,
} from "./components/toast";
export { VirtualizedList } from "./components/virtualized-list";
export { PaginatedVirtualizedList } from "./components/paginated-virtualized-list";
export {
  AdvancedFilterBar,
  EMPTY_FILTERS,
  hasActiveFilters,
} from "./components/advanced-filter-bar";
export type { FilterState } from "./components/advanced-filter-bar";