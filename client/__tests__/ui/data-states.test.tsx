import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { DataStates, useDataState, DataComponent, dataStatePresets } from "@syncro/ui";

describe("DataStates", () => {
  it("renders children in idle state", () => {
    render(
      <DataStates state="idle">
        <div data-testid="content">Idle content</div>
      </DataStates>
    );

    expect(screen.getByTestId("content")).toBeInTheDocument();
  });

  it("renders children in success state", () => {
    render(
      <DataStates state="success">
        <div data-testid="content">Success content</div>
      </DataStates>
    );

    expect(screen.getByTestId("content")).toBeInTheDocument();
  });

  it("shows loading skeletons", () => {
    render(
      <DataStates state="loading" config={{ loading: { count: 3 } }} />
    );

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(3);
  });

  it("shows overlay loading when configured", () => {
    render(
      <DataStates state="loading" config={{ loading: { overlay: true, message: "Refreshing..." } }}>
        <div data-testid="content">Content</div>
      </DataStates>
    );

    expect(screen.getByText("Refreshing...")).toBeInTheDocument();
    expect(screen.getByTestId("content")).toBeInTheDocument();
  });

  it("shows error state with retry button", () => {
    const onRetry = vi.fn();
    render(
      <DataStates
        state="error"
        error="Failed to load"
        config={{ error: { variant: "default", onRetry } }}
      />
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Failed to load")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("calls onRetry when retry button clicked", () => {
    const onRetry = vi.fn();
    render(
      <DataStates
        state="error"
        error="Failed to load"
        config={{ error: { variant: "default", onRetry } }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("shows different error variants", () => {
    render(
      <DataStates
        state="error"
        error="Network error"
        config={{ error: { variant: "network" } }}
      />
    );

    expect(screen.getByText("Connection error")).toBeInTheDocument();
  });

  it("shows empty state with default config", () => {
    render(<DataStates state="empty" />);

    expect(screen.getByText("No data")).toBeInTheDocument();
    expect(screen.getByText("There's nothing to show here yet.")).toBeInTheDocument();
  });

  it("shows empty state with search variant", () => {
    render(<DataStates state="empty" config={{ empty: { variant: "search" } }} />);

    expect(screen.getByText("No results")).toBeInTheDocument();
    expect(screen.getByText("Try adjusting your search or filters.")).toBeInTheDocument();
  });

  it("shows empty state with filter variant", () => {
    render(<DataStates state="empty" config={{ empty: { variant: "filter" } }} />);

    expect(screen.getByText("No matches")).toBeInTheDocument();
  });

  it("shows empty state with permission variant", () => {
    render(<DataStates state="empty" config={{ empty: { variant: "permission" } }} />);

    expect(screen.getByText("Access denied")).toBeInTheDocument();
  });

  it("shows empty state with custom action", () => {
    const onAction = vi.fn();
    render(
      <DataStates
        state="empty"
        config={{ empty: { action: { label: "Create", onClick: onAction } }}}
      />
    );

    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(onAction).toHaveBeenCalled();
  });

  it("shows success toast message", () => {
    render(
      <DataStates
        state="success"
        config={{ success: { message: "Saved!", duration: 100 } }}
      >
        <div>Content</div>
      </DataStates>
    );

    expect(screen.getByText("Success")).toBeInTheDocument();
    expect(screen.getByText("Saved!")).toBeInTheDocument();
  });
});

describe("useDataState hook", () => {
  it("manages loading and success states", async () => {
    let resolvePromise: (value: string[]) => void;
    const promise = new Promise<string[]>((resolve) => {
      resolvePromise = resolve;
    });

    const fetchFn = vi.fn(() => promise);

    const { result } = renderHook(() => useDataState(fetchFn, { initialState: "idle" }));

    expect(result.current.state).toBe("idle");

    act(() => {
      result.current.execute();
    });

    expect(result.current.state).toBe("loading");

    await act(async () => {
      resolvePromise!(["item1", "item2"]);
      await promise;
    });

    expect(result.current.state).toBe("success");
    expect(result.current.data).toEqual(["item1", "item2"]);
  });

  it("manages error state", async () => {
    const fetchFn = vi.fn(() => Promise.reject(new Error("Network error")));

    const { result } = renderHook(() => useDataState(fetchFn, { initialState: "idle" }));

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.state).toBe("error");
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe("Network error");
  });

  it("provides retry function", async () => {
    let resolvePromise: (value: string[]) => void;
    let rejectPromise: (error: Error) => void;

    const createPromise = () =>
      new Promise<string[]>((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
      });

    const fetchFn = vi.fn(() => createPromise());

    const { result } = renderHook(() => useDataState(fetchFn, { initialState: "idle" }));

    await act(async () => {
      await result.current.execute();
      rejectPromise!(new Error("Failed"));
    });

    expect(result.current.state).toBe("error");

    await act(async () => {
      await result.current.retry();
      resolvePromise!(["retry success"]);
    });

    expect(result.current.state).toBe("success");
    expect(result.current.data).toEqual(["retry success"]);
  });

  it("provides reset function", async () => {
    const fetchFn = vi.fn(() => Promise.resolve(["data"]));

    const { result } = renderHook(() => useDataState(fetchFn, { initialState: "idle" }));

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.state).toBe("success");

    act(() => {
      result.current.reset();
    });

    expect(result.current.state).toBe("idle");
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });
});

describe("DataComponent", () => {
  it("fetches and renders data", async () => {
    const fetchFn = vi.fn(() => Promise.resolve(["Item 1", "Item 2"]));

    render(
      <DataComponent
        fetchFn={fetchFn}
        render={(data) => (
          <ul>
            {data.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        )}
        initialState="loading"
        config={dataStatePresets.list}
      />
    );

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Item 1")).toBeInTheDocument();
      expect(screen.getByText("Item 2")).toBeInTheDocument();
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("shows empty state when no data", async () => {
    const fetchFn = vi.fn(() => Promise.resolve([]));

    render(
      <DataComponent
        fetchFn={fetchFn}
        render={(data) => <ul>{data.map((item, i) => <li key={i}>{item}</li>)}</ul>}
        initialState="loading"
        config={dataStatePresets.list}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("No data")).toBeInTheDocument();
    });
  });

  it("shows error state on fetch failure", async () => {
    const fetchFn = vi.fn(() => Promise.reject(new Error("Failed")));

    render(
      <DataComponent
        fetchFn={fetchFn}
        render={(data) => <ul>{data.map((item, i) => <li key={i}>{item}</li>)}</ul>}
        initialState="loading"
        config={dataStatePresets.list}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    });
  });
});

describe("dataStatePresets", () => {
  it("exports tableSearch preset", () => {
    expect(dataStatePresets.tableSearch.empty?.variant).toBe("search");
  });

  it("exports tableFilter preset", () => {
    expect(dataStatePresets.tableFilter.empty?.variant).toBe("filter");
  });

  it("exports metric preset", () => {
    expect(dataStatePresets.metric.loading?.overlay).toBe(true);
  });

  it("exports chart preset", () => {
    expect(dataStatePresets.chart.loading?.message).toBe("Rendering chart...");
  });

  it("exports list preset", () => {
    expect(dataStatePresets.list.loading?.count).toBe(3);
  });
});

// Helper for testing hooks
function renderHook<T>(hook: () => T) {
  let result: T;
  const TestComponent = () => {
    result = hook();
    return null;
  };
  render(<TestComponent />);
  return { result: { current: result! } };
}