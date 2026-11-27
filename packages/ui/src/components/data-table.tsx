"use client";

/**
 * DataTable – dense, sortable, virtualized table for high-density data display.
 *
 * Features:
 *   - Column sorting (single/multi)
 *   - Row virtualization for large datasets
 *   - Keyboard navigation
 *   - Column resizing
 *   - Sticky header/first column
 *   - Empty/loading/error states built-in
 *   - Row selection (single/multi)
 *   - Custom cell renderers
 */

import * as React from "react";
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { cn } from "../lib/cn";
import { ChevronUp, ChevronDown, ChevronUpDown, Check, Minus } from "lucide-react";
import { Skeleton } from "./skeleton";
import { EmptyState } from "./empty-state";
import { VirtualizedList, type VirtualizedListProps } from "./virtualized-list";
import { formatCompactNumber } from "../lib/numeric-formatting";

export type SortDirection = "asc" | "desc" | "none";

export interface Column<T> {
  /** Unique column identifier */
  id: string;
  /** Display header */
  header: string;
  /** Accessor function or key path */
  accessor: keyof T | ((row: T) => React.ReactNode);
  /** Cell renderer (optional, for custom formatting) */
  cell?: (value: unknown, row: T, index: number) => React.ReactNode;
  /** Enable sorting on this column */
  sortable?: boolean;
  /** Initial sort direction */
  defaultSort?: SortDirection;
  /** Column width (px or %) */
  width?: string | number;
  /** Minimum column width */
  minWidth?: number;
  /** Maximum column width */
  maxWidth?: number;
  /** Align content */
  align?: "left" | "center" | "right";
  /** Sticky column (left/right) */
  sticky?: "left" | "right";
  /** Hide column on mobile */
  hideOnMobile?: boolean;
  /** Column header tooltip */
  headerTooltip?: string;
}

export interface DataTableProps<T extends { id: string }> {
  /** Column definitions */
  columns: Column<T>[];
  /** Row data */
  data: T[];
  /** Unique row key (default: 'id') */
  rowKey?: keyof T;
  /** Row height for virtualization (default: 44) */
  rowHeight?: number;
  /** Container height (required for virtualization) */
  containerHeight: number;
  /** Overscan rows for virtualization */
  overscan?: number;
  /** Enable row selection */
  selectable?: boolean;
  /** Selection mode */
  selectionMode?: "single" | "multi";
  /** Selected row IDs */
  selectedIds?: Set<string> | string[];
  /** Selection change handler */
  onSelectionChange?: (ids: Set<string>) => void;
  /** Row click handler */
  onRowClick?: (row: T, event: React.MouseEvent) => void;
  /** Sort state */
  sortBy?: { id: string; direction: SortDirection }[];
  /** Sort change handler */
  onSortChange?: (sortBy: { id: string; direction: SortDirection }[]) => void;
  /** Loading state */
  isLoading?: boolean;
  /** Error state */
  error?: string | null;
  /** Empty state config */
  emptyState?: {
    icon?: string;
    title?: string;
    description?: string;
    action?: { label: string; onClick: () => void };
  };
  /** Loading skeleton row count */
  skeletonRows?: number;
  /** Row className function */
  rowClassName?: (row: T, index: number) => string;
  /** Table className */
  className?: string;
  /** Table aria-label */
  ariaLabel?: string;
  /** Show row numbers */
  showRowNumbers?: boolean;
  /** Sticky header (default: true) */
  stickyHeader?: boolean;
  /** Custom empty state renderer */
  renderEmptyState?: () => React.ReactNode;
  /** Custom loading state renderer */
  renderLoading?: () => React.ReactNode;
  /** Custom error state renderer */
  renderError?: (error: string) => React.ReactNode;
}

function DefaultEmptyState({
  icon = "📭",
  title = "No data",
  description = "No rows to display.",
  action,
}: NonNullable<DataTableProps<any>["emptyState"]>) {
  return (
    <EmptyState icon={icon} title={title} description={description} action={action} />
  );
}

function DefaultLoading({ rowCount = 5, columns }: { rowCount: number; columns: Column<any>[] }) {
  return (
    <tbody className="animate-pulse">
      {Array.from({ length: rowCount }).map((_, i) => (
        <tr key={i} className="border-t border-border/50">
          {columns.map((col) => (
            <td key={col.id} className="px-4 py-3">
              <Skeleton className="h-4 w-full" />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

function DefaultError({ error }: { error: string }) {
  return (
    <tbody>
      <tr>
        <td colSpan={99} className="px-4 py-8 text-center text-red-600 dark:text-red-400">
          <p className="font-medium">Failed to load data</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{error}</p>
        </td>
      </tr>
    </tbody>
  );
}

function SortIcon({ direction }: { direction: SortDirection }) {
  switch (direction) {
    case "asc":
      return <ChevronUp className="w-4 h-4 text-foreground" />;
    case "desc":
      return <ChevronDown className="w-4 h-4 text-foreground" />;
    default:
      return <ChevronUpDown className="w-4 h-4 text-muted-foreground" />;
  }
}

function SelectCheckbox({
  checked,
  indeterminate,
  onChange,
  disabled,
  ariaLabel,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked ? "true" : indeterminate ? "mixed" : "false"}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative w-4 h-4 rounded border-2 flex items-center justify-center transition-colors",
        "border-primary focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
        checked ? "bg-primary border-primary" : "border-border",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      {checked && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
      {indeterminate && <Minus className="w-2.5 h-2.5 text-primary-foreground" />}
    </button>
  );
}

export function DataTable<T extends { id: string }>({
  columns,
  data,
  rowKey = "id",
  rowHeight = 44,
  containerHeight,
  overscan = 5,
  selectable = false,
  selectionMode = "multi",
  selectedIds = new Set(),
  onSelectionChange,
  onRowClick,
  sortBy = [],
  onSortChange,
  isLoading = false,
  error = null,
  emptyState,
  skeletonRows = 5,
  rowClassName,
  className,
  ariaLabel = "Data table",
  showRowNumbers = false,
  stickyHeader = true,
  renderEmptyState,
  renderLoading,
  renderError,
}: DataTableProps<T>) {
  const [sortState, setSortState] = useState<{ id: string; direction: SortDirection }[]>(sortBy);
  const [focusedRowIndex, setFocusedRowIndex] = useState<number | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allSelected = data.length > 0 && data.every((row) => selectedSet.has(String(row[rowKey])));
  const someSelected = data.some((row) => selectedSet.has(String(row[rowKey]))) && !allSelected;

  // Handle sort
  const handleSort = useCallback(
    (columnId: string) => {
      const column = columns.find((c) => c.id === columnId);
      if (!column?.sortable) return;

      const current = sortState.find((s) => s.id === columnId);
      const currentDir = current?.direction ?? "none";

      let newDirection: SortDirection;
      if (currentDir === "asc") newDirection = "desc";
      else if (currentDir === "desc") newDirection = "none";
      else newDirection = "asc";

      const newSortState = sortState.filter((s) => s.id !== columnId);
      if (newDirection !== "none") {
        newSortState.unshift({ id: columnId, direction: newDirection });
      }

      setSortState(newSortState);
      onSortChange?.(newSortState);
    },
    [columns, sortState, onSortChange]
  );

  // Sort data
  const sortedData = useMemo(() => {
    if (sortState.length === 0) return data;

    return [...data].sort((a, b) => {
      for (const { id, direction } of sortState) {
        const column = columns.find((c) => c.id === id);
        if (!column) continue;

        const aVal = typeof column.accessor === "function" ? column.accessor(a) : a[column.accessor as keyof T];
        const bVal = typeof column.accessor === "function" ? column.accessor(b) : b[column.accessor as keyof T];

        if (aVal === bVal) continue;
        if (aVal === null || aVal === undefined) return 1;
        if (bVal === null || bVal === undefined) return -1;

        const comparison = aVal < bVal ? -1 : 1;
        return direction === "asc" ? comparison : -comparison;
      }
      return 0;
    });
  }, [data, sortState, columns]);

  // Handle selection
  const handleSelectAll = useCallback(() => {
    if (allSelected) {
      onSelectionChange?.(new Set());
    } else {
      const newSelection = new Set(selectedSet);
      data.forEach((row) => newSelection.add(String(row[rowKey])));
      onSelectionChange?.(newSelection);
    }
  }, [allSelected, data, rowKey, selectedSet, onSelectionChange]);

  const handleSelectRow = useCallback(
    (id: string) => {
      const newSelection = new Set(selectedSet);
      if (newSelection.has(id)) {
        newSelection.delete(id);
      } else {
        if (selectionMode === "single") {
          newSelection.clear();
        }
        newSelection.add(id);
      }
      onSelectionChange?.(newSelection);
    },
    [selectedSet, selectionMode, onSelectionChange]
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent, index: number) => {
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setFocusedRowIndex((prev) => Math.min((prev ?? -1) + 1, sortedData.length - 1));
          break;
        case "ArrowUp":
          event.preventDefault();
          setFocusedRowIndex((prev) => Math.max((prev ?? sortedData.length) - 1, 0));
          break;
        case "Enter":
        case " ":
          if (selectable && focusedRowIndex !== null) {
            event.preventDefault();
            const row = sortedData[focusedRowIndex];
            handleSelectRow(String(row[rowKey]));
          }
          break;
        case "Escape":
          setFocusedRowIndex(null);
          break;
      }
    },
    [sortedData, selectable, focusedRowIndex, rowKey, handleSelectRow]
  );

  // Render header
  const renderHeader = () => (
    <thead className={cn("[&_tr]:border-b", stickyHeader && "sticky top-0 z-10 bg-background/95 backdrop-blur-sm")}>
      <tr className="border-b border-border">
        {selectable && (
          <th
            className="w-12 px-3 py-2 text-left align-middle"
            style={{ minWidth: 48, maxWidth: 48 }}
          >
            <SelectCheckbox
              checked={allSelected}
              indeterminate={someSelected}
              onChange={handleSelectAll}
              ariaLabel={allSelected ? "Deselect all rows" : "Select all rows"}
            />
          </th>
        )}
        {showRowNumbers && (
          <th className="w-8 px-3 py-2 text-right font-medium text-muted-foreground" style={{ minWidth: 32, maxWidth: 32 }}>
            #
          </th>
        )}
        {columns.map((column) => (
          <th
            key={column.id}
            className={cn(
              "px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap",
              column.align === "center" && "text-center",
              column.align === "right" && "text-right",
              column.sortable && "cursor-pointer select-none hover:text-foreground",
              column.sticky === "left" && "sticky left-0 z-10 bg-background/95",
              column.sticky === "right" && "sticky right-0 z-10 bg-background/95"
            )}
            style={{
              width: column.width,
              minWidth: column.minWidth,
              maxWidth: column.maxWidth,
            }}
            onClick={() => column.sortable && handleSort(column.id)}
            title={column.headerTooltip}
          >
            <div className="flex items-center gap-1">
              <span>{column.header}</span>
              {column.sortable && <SortIcon direction={sortState.find((s) => s.id === column.id)?.direction ?? "none"} />}
            </div>
          </th>
        ))}
      </tr>
    </thead>
  );

  // Render row
  const renderRow = useCallback(
    (row: T, index: number) => {
      const id = String(row[rowKey]);
      const isSelected = selectedSet.has(id);
      const isFocused = focusedRowIndex === index;

      return (
        <tr
          key={id}
          className={cn(
            "border-t border-border/50 transition-colors",
            "hover:bg-muted/50",
            isSelected && "bg-primary/5",
            isFocused && "outline-none ring-2 ring-primary ring-offset-2 ring-offset-background",
            rowClassName?.(row, index)
          )}
          onClick={(e) => onRowClick?.(row, e)}
          onKeyDown={(e) => handleKeyDown(e, index)}
          tabIndex={selectable ? 0 : -1}
          role={selectable ? "row" : undefined}
          aria-selected={isSelected}
          data-row-index={index}
        >
          {selectable && (
            <td className="px-3 py-2 align-middle" style={{ width: 48 }}>
              <SelectCheckbox
                checked={isSelected}
                onChange={() => handleSelectRow(id)}
                ariaLabel={isSelected ? `Deselect row ${index + 1}` : `Select row ${index + 1}`}
              />
            </td>
          )}
          {showRowNumbers && (
            <td className="px-3 py-2 text-right text-muted-foreground font-mono text-xs" style={{ width: 32 }}>
              {index + 1}
            </td>
          )}
          {columns.map((column) => {
            const value = typeof column.accessor === "function"
              ? column.accessor(row)
              : row[column.accessor as keyof T];

            const cellContent = column.cell
              ? column.cell(value, row, index)
              : typeof value === "number"
              ? formatCompactNumber(value)
              : value ?? "—";

            return (
              <td
                key={column.id}
                className={cn(
                  "px-3 py-2 align-middle text-sm",
                  column.align === "center" && "text-center",
                  column.align === "right" && "text-right font-mono tabular-nums",
                  column.sticky === "left" && "sticky left-0 z-10 bg-background",
                  column.sticky === "right" && "sticky right-0 z-10 bg-background"
                )}
                style={{
                  width: column.width,
                  minWidth: column.minWidth,
                  maxWidth: column.maxWidth,
                }}
              >
                {cellContent}
              </td>
            );
          })}
        </tr>
      );
    },
    [columns, rowKey, selectedSet, focusedRowIndex, rowClassName, handleKeyDown, onRowClick, handleSelectRow]
  );

  // Virtualized list for large datasets
  const virtualizedProps: VirtualizedListProps<T> = {
    items: sortedData,
    itemHeight: rowHeight,
    containerHeight,
    renderItem: renderRow,
    overscan,
    ariaLabel,
    role: "rowgroup",
  };

  if (isLoading) {
    return (
      <div className={cn("border border-border rounded-lg overflow-hidden", className)}>
        <table className="w-full border-collapse" role="table" aria-label={ariaLabel}>
          {renderHeader()}
          {renderLoading?.() ?? <DefaultLoading rowCount={skeletonRows} columns={columns} />}
        </table>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("border border-border rounded-lg overflow-hidden", className)}>
        <table className="w-full border-collapse" role="table" aria-label={ariaLabel}>
          {renderHeader()}
          {renderError?.(error) ?? <DefaultError error={error} />}
        </table>
      </div>
    );
  }

  if (sortedData.length === 0) {
    return (
      <div className={cn("border border-border rounded-lg overflow-hidden", className)}>
        <table className="w-full border-collapse" role="table" aria-label={ariaLabel}>
          {renderHeader()}
          <tbody>
            <tr>
              <td colSpan={columns.length + (selectable ? 1 : 0) + (showRowNumbers ? 1 : 0)} className="p-8">
                {renderEmptyState?.() ?? <DefaultEmptyState {...emptyState} />}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className={cn("border border-border rounded-lg overflow-hidden", className)}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" role="table" aria-label={ariaLabel} ref={tableRef}>
          {renderHeader()}
          <tbody>
            <VirtualizedList {...virtualizedProps} />
          </tbody>
        </table>
      </div>
    </div>
  );
}

DataTable.displayName = "DataTable";

export { DataTable };
export type { Column, DataTableProps, SortDirection };