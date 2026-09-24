import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
  DataStates,
  useDataState,
  DataComponent,
  dataStatePresets,
} from "@syncro/ui";

const meta = {
  title: "Data/DataStates",
  component: DataStates,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  argTypes: {
    state: { control: "select", options: ["idle", "loading", "error", "empty", "success"] },
  },
} satisfies Meta<typeof DataStates>;

export default meta;
type Story = StoryObj<typeof meta>;

// Mock data fetcher
const fetchMockData = async (shouldFail = false): Promise<string[]> => {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  if (shouldFail) throw new Error("Network error: Failed to fetch data");
  return ["Item 1", "Item 2", "Item 3", "Item 4", "Item 5"];
};

export const AllStates: Story = {
  render: () => (
    <div className="space-y-8">
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-4">Idle</h3>
        <DataStates state="idle" config={dataStatePresets.tableSearch}>
          <div className="p-4 bg-card border rounded-lg">Content goes here</div>
        </DataStates>
      </div>
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-4">Loading</h3>
        <DataStates state="loading" config={dataStatePresets.tableSearch} />
      </div>
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-4">Error (default)</h3>
        <DataStates state="error" error="Failed to load data" config={dataStatePresets.tableSearch} />
      </div>
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-4">Error (network)</h3>
        <DataStates
          state="error"
          error="Connection timeout"
          config={{
            ...dataStatePresets.tableSearch,
            error: { variant: "network", onRetry: () => {} },
          }}
        />
      </div>
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-4">Empty (default)</h3>
        <DataStates state="empty" config={dataStatePresets.tableSearch} />
      </div>
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-4">Empty (search)</h3>
        <DataStates state="empty" config={{ empty: { variant: "search" } }} />
      </div>
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-4">Empty (filter)</h3>
        <DataStates state="empty" config={{ empty: { variant: "filter" } }} />
      </div>
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-4">Empty (permission)</h3>
        <DataStates state="empty" config={{ empty: { variant: "permission" } }} />
      </div>
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-4">Success</h3>
        <DataStates
          state="success"
          config={{
            success: { message: "Data saved successfully!", duration: 3000 },
          }}
        >
          <div className="p-4 bg-card border rounded-lg">Content after success</div>
        </DataStates>
      </div>
    </div>
  ),
};

export const InteractiveExample: Story = {
  render: () => {
    const [state, setState] = useState<"idle" | "loading" | "error" | "empty" | "success">("idle");
    const [data, setData] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);

    const handleLoad = async () => {
      setState("loading");
      setError(null);
      try {
        const result = await fetchMockData();
        setData(result);
        setState(result.length === 0 ? "empty" : "success");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        setState("error");
      }
    };

    const handleLoadFail = async () => {
      setState("loading");
      setError(null);
      try {
        await fetchMockData(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        setState("error");
      }
    };

    const handleLoadEmpty = async () => {
      setState("loading");
      setError(null);
      setData([]);
      setState("empty");
    };

    return (
      <div className="space-y-4">
        <div className="flex gap-2">
          <button onClick={handleLoad} className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90">
            Load Data
          </button>
          <button onClick={handleLoadEmpty} className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90">
            Load Empty
          </button>
          <button onClick={handleLoadFail} className="px-4 py-2 bg-destructive text-destructive-foreground rounded hover:bg-destructive/90">
            Load Error
          </button>
          <button onClick={() => { setState("idle"); setData([]); setError(null); }} className="px-4 py-2 border rounded hover:bg-muted">
            Reset
          </button>
        </div>
        <DataStates
          state={state}
          error={error}
          config={{
            empty: { variant: "default", title: "No items", description: "Click 'Load Data' to fetch items." },
            error: { variant: "default", onRetry: handleLoad },
          }}
        >
          <ul className="space-y-2">
            {data.map((item, i) => (
              <li key={i} className="p-3 bg-card border rounded-lg flex items-center justify-between">
                <span>{item}</span>
                <span className="text-sm text-muted-foreground">Item {i + 1}</span>
              </li>
            ))}
          </ul>
        </DataStates>
      </div>
    );
  },
};

export const WithOverlayLoading: Story = {
  render: () => {
    const [isLoading, setIsLoading] = useState(false);

    return (
      <div className="relative">
        <div className="space-y-4 p-4 bg-card border rounded-lg">
          <h3 className="font-medium">Data Table</h3>
          <div className="space-y-2 mt-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="p-3 bg-muted rounded flex items-center justify-between">
                <span>Row {i}</span>
                <span className="text-sm text-muted-foreground">Data</span>
              </div>
            ))}
          </div>
        </div>
        <DataStates
          state={isLoading ? "loading" : "idle"}
          config={{ loading: { count: 5, overlay: true, message: "Refreshing data..." } }}
        >
          <div className="absolute inset-0" />
        </DataStates>
        <button
          onClick={() => {
            setIsLoading(true);
            setTimeout(() => setIsLoading(false), 2000);
          }}
          className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
          disabled={isLoading}
        >
          {isLoading ? "Loading..." : "Trigger Overlay Loading"}
        </button>
      </div>
    );
  },
};

export const UseDataStateHook: Story = {
  render: () => {
    const { state, data, error, execute, retry, reset } = useDataState(
      async () => {
        const result = await fetchMockData();
        return result;
      },
      {
        initialState: "idle",
        config: dataStatePresets.list,
      }
    );

    return (
      <div className="space-y-4">
        <div className="flex gap-2">
          <button onClick={execute} disabled={state === "loading"} className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50">
            {state === "loading" ? "Loading..." : "Fetch Data"}
          </button>
          <button onClick={retry} disabled={state !== "error"} className="px-4 py-2 border rounded hover:bg-muted disabled:opacity-50">
            Retry
          </button>
          <button onClick={reset} className="px-4 py-2 border rounded hover:bg-muted">
            Reset
          </button>
        </div>
        <DataStates state={state} error={error} config={dataStatePresets.list}>
          <ul className="space-y-2">
            {data?.map((item, i) => (
              <li key={i} className="p-3 bg-card border rounded-lg">{item}</li>
            ))}
          </ul>
        </DataStates>
      </div>
    );
  },
};

export const DataComponentExample: Story = {
  render: () => (
    <DataComponent
      fetchFn={async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return ["Server 1", "Server 2", "Server 3"];
      }}
      render={(servers) => (
        <ul className="space-y-2">
          {servers.map((s, i) => (
            <li key={i} className="p-3 bg-card border rounded-lg flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              <span>{s}</span>
              <span className="text-sm text-muted-foreground ml-auto">Healthy</span>
            </li>
          ))}
        </ul>
      )}
      config={dataStatePresets.list}
      initialState="loading"
    />
  ),
};

export const Presets: Story = {
  render: () => (
    <div className="space-y-8">
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-4">Table Search Preset</h3>
        <DataStates state="empty" config={dataStatePresets.tableSearch} />
      </div>
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-4">Table Filter Preset</h3>
        <DataStates state="empty" config={dataStatePresets.tableFilter} />
      </div>
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-4">Metric Preset</h3>
        <DataStates state="loading" config={dataStatePresets.metric} />
      </div>
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-4">Chart Preset</h3>
        <DataStates state="loading" config={dataStatePresets.chart} />
      </div>
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-4">List Preset</h3>
        <DataStates state="loading" config={dataStatePresets.list} />
      </div>
    </div>
  ),
};