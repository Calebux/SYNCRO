import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DataTable } from "@syncro/ui";

interface TestRow {
  id: string;
  name: string;
  value: number;
  status: "active" | "inactive";
}

const columns = [
  { id: "name", header: "Name", accessor: "name" as keyof TestRow, sortable: true },
  { id: "value", header: "Value", accessor: "value" as keyof TestRow, sortable: true, align: "right" as const },
  { id: "status", header: "Status", accessor: "status" as keyof TestRow },
];

const mockData: TestRow[] = [
  { id: "1", name: "Item A", value: 100, status: "active" },
  { id: "2", name: "Item B", value: 200, status: "inactive" },
  { id: "3", name: "Item C", value: 300, status: "active" },
];

describe("DataTable", () => {
  it("renders table with header and rows", () => {
    render(
      <DataTable
        columns={columns}
        data={mockData}
        containerHeight={300}
        ariaLabel="Test table"
      />
    );

    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Value")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Item A")).toBeInTheDocument();
    expect(screen.getByText("Item B")).toBeInTheDocument();
    expect(screen.getByText("Item C")).toBeInTheDocument();
  });

  it("shows empty state when no data", () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        containerHeight={300}
        emptyState={{ title: "No items", description: "Create one to get started" }}
        ariaLabel="Test table"
      />
    );

    expect(screen.getByText("No items")).toBeInTheDocument();
    expect(screen.getByText("Create one to get started")).toBeInTheDocument();
  });

  it("shows loading state", () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        containerHeight={300}
        isLoading={true}
        ariaLabel="Test table"
      />
    );

    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("shows error state", () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        containerHeight={300}
        error="Failed to load"
        ariaLabel="Test table"
      />
    );

    expect(screen.getByText("Failed to load data")).toBeInTheDocument();
    expect(screen.getByText("Failed to load")).toBeInTheDocument();
  });

  it("sorts data when clicking sortable header", () => {
    render(
      <DataTable
        columns={columns}
        data={mockData}
        containerHeight={300}
        ariaLabel="Test table"
      />
    );

    // Click on Value header to sort
    const valueHeader = screen.getByText("Value");
    fireEvent.click(valueHeader);

    // Should show ascending sort (100, 200, 300)
    const rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("100");
    expect(rows[2]).toHaveTextContent("200");
    expect(rows[3]).toHaveTextContent("300");
  });

  it("toggles sort direction on repeated clicks", () => {
    render(
      <DataTable
        columns={columns}
        data={mockData}
        containerHeight={300}
        ariaLabel="Test table"
      />
    );

    const valueHeader = screen.getByText("Value");
    fireEvent.click(valueHeader); // asc
    fireEvent.click(valueHeader); // desc

    const rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("300");
    expect(rows[2]).toHaveTextContent("200");
    expect(rows[3]).toHaveTextContent("100");
  });

  it("supports row selection", () => {
    const onSelectionChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={mockData}
        containerHeight={300}
        selectable={true}
        onSelectionChange={onSelectionChange}
        ariaLabel="Test table"
      />
    );

    // Click checkbox for first row
    const checkbox = screen.getAllByRole("checkbox")[1]; // first row checkbox
    fireEvent.click(checkbox);

    expect(onSelectionChange).toHaveBeenCalledWith(expect.objectContaining({
      has: expect.any(Function),
    }));
  });

  it("supports select all", () => {
    const onSelectionChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={mockData}
        containerHeight={300}
        selectable={true}
        onSelectionChange={onSelectionChange}
        ariaLabel="Test table"
      />
    );

    // Click select all checkbox
    const selectAllCheckbox = screen.getByRole("checkbox", { name: /select all/i });
    fireEvent.click(selectAllCheckbox);

    expect(onSelectionChange).toHaveBeenCalled();
  });

  it("shows row numbers when enabled", () => {
    render(
      <DataTable
        columns={columns}
        data={mockData}
        containerHeight={300}
        showRowNumbers={true}
        ariaLabel="Test table"
      />
    );

    expect(screen.getByText("#")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("calls onRowClick when row clicked", () => {
    const onRowClick = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={mockData}
        containerHeight={300}
        onRowClick={onRowClick}
        ariaLabel="Test table"
      />
    );

    const firstRow = screen.getByText("Item A").closest("tr");
    fireEvent.click(firstRow!);

    expect(onRowClick).toHaveBeenCalledWith(mockData[0], expect.any(Object));
  });

  it("applies custom row className", () => {
    render(
      <DataTable
        columns={columns}
        data={mockData}
        containerHeight={300}
        rowClassName={(row) => row.status === "active" ? "bg-green-50" : "bg-red-50"}
        ariaLabel="Test table"
      />
    );

    const rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveClass("bg-green-50");
    expect(rows[2]).toHaveClass("bg-red-50");
    expect(rows[3]).toHaveClass("bg-green-50");
  });

  it("supports custom cell renderers", () => {
    const columnsWithRenderer = [
      { id: "name", header: "Name", accessor: "name" as keyof TestRow },
      {
        id: "value",
        header: "Value",
        accessor: "value" as keyof TestRow,
        cell: (value: number) => <strong>${value}</strong>,
      },
    ];

    render(
      <DataTable
        columns={columnsWithRenderer}
        data={mockData}
        containerHeight={300}
        ariaLabel="Test table"
      />
    );

    expect(screen.getByText("$100")).toBeInTheDocument();
    expect(screen.getByText("$200")).toBeInTheDocument();
    expect(screen.getByText("$300")).toBeInTheDocument();
  });

  it("has proper accessibility attributes", () => {
    render(
      <DataTable
        columns={columns}
        data={mockData}
        containerHeight={300}
        ariaLabel="Test table"
      />
    );

    const table = screen.getByRole("table");
    expect(table).toHaveAttribute("aria-label", "Test table");
  });
});