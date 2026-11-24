import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Amount,
  StroopsAmount,
  Balance,
  CompactNumber,
  Nonce,
  Rate,
  Delta,
  MetricCard,
  MetricGrid,
} from "@syncro/ui";

describe("Amount", () => {
  it("formats settlement amount with 6 decimals", () => {
    render(<Amount value={1_234_567} />);
    expect(screen.getByTestId("amount")).toHaveTextContent("1.234567 USDC");
  });

  it("formats with custom asset", () => {
    render(
      <Amount
        value={1_000_000}
        asset={{ code: "XLM", symbol: "XLM", decimals: 7, baseUnit: 10_000_000 }}
      />
    );
    expect(screen.getByTestId("amount")).toHaveTextContent("0.1000000 XLM");
  });

  it("shows blank zero when enabled", () => {
    render(<Amount value={0} blankZero />);
    expect(screen.getByTestId("amount")).toHaveTextContent("—");
  });

  it("applies size and weight classes", () => {
    render(<Amount value={1_000_000} size="lg" weight="bold" />);
    const el = screen.getByTestId("amount");
    expect(el).toHaveClass("text-lg");
    expect(el).toHaveClass("font-bold");
  });
});

describe("StroopsAmount", () => {
  it("converts stroops to XLM", () => {
    render(<StroopsAmount value={10_000_000} />);
    expect(screen.getByTestId("stroops-amount")).toHaveTextContent("1.0000000 XLM");
  });

  it("never renders raw stroops as float", () => {
    render(<StroopsAmount value={10_000_000} />);
    const text = screen.getByTestId("stroops-amount").textContent;
    expect(text).not.toContain("10000000");
    expect(text).toBe("1.0000000 XLM");
  });

  it("handles fractional stroops", () => {
    render(<StroopsAmount value={1_500_000} />);
    expect(screen.getByTestId("stroops-amount")).toHaveTextContent("0.1500000 XLM");
  });
});

describe("Balance", () => {
  it("formats balance with asset", () => {
    render(<Balance value={1_234_567} />);
    expect(screen.getByTestId("balance")).toHaveTextContent("1.234567 USDC");
  });

  it("shows blank zero", () => {
    render(<Balance value={0} blankZero />);
    expect(screen.getByTestId("balance")).toHaveTextContent("—");
  });
});

describe("CompactNumber", () => {
  it("formats compact numbers", () => {
    render(<CompactNumber value={1_234} />);
    expect(screen.getByTestId("compact-number")).toHaveTextContent("1.2K");

    render(<CompactNumber value={1_234_567} />);
    expect(screen.getByTestId("compact-number")).toHaveTextContent("1.2M");
  });

  it("respects precision", () => {
    render(<CompactNumber value={1_234_567} precision={2} />);
    expect(screen.getByTestId("compact-number")).toHaveTextContent("1.23M");
  });
});

describe("Nonce", () => {
  it("formats nonce without grouping", () => {
    render(<Nonce value={12345} />);
    expect(screen.getByTestId("nonce")).toHaveTextContent("12345");

    render(<Nonce value={999999999} />);
    expect(screen.getByTestId("nonce")).toHaveTextContent("999999999");
  });
});

describe("Rate", () => {
  it("formats rate with unit", () => {
    render(<Rate value={123.4567} unit="calls/sec" />);
    expect(screen.getByTestId("rate")).toHaveTextContent("123.4567 calls/sec");
  });

  it("respects precision", () => {
    render(<Rate value={0.000045} unit="USDC/call" precision={6} />);
    expect(screen.getByTestId("rate")).toHaveTextContent("0.000045 USDC/call");
  });
});

describe("Delta", () => {
  it("shows positive delta with + sign", () => {
    render(<Delta value={150} />);
    expect(screen.getByRole("status")).toHaveTextContent("+150.00");
  });

  it("shows negative delta with − sign", () => {
    render(<Delta value={-75} />);
    expect(screen.getByRole("status")).toHaveTextContent("−75.00");
  });

  it("shows zero delta", () => {
    render(<Delta value={0} />);
    expect(screen.getByRole("status")).toHaveTextContent("0.00");
  });

  it("formats monetary delta with asset", () => {
    render(
      <Delta
        value={1_234_567}
        asset={{ code: "USDC", symbol: "USDC", decimals: 6, baseUnit: 1_000_000 }}
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent("+1.234567 USDC");
  });

  it("formats percentage delta", () => {
    render(<Delta value={5.2} asPercent />);
    expect(screen.getByRole("status")).toHaveTextContent("+5.2%");
  });

  it("shows trend icon when enabled", () => {
    render(<Delta value={150} showIcon />);
    expect(screen.getByRole("status").querySelector("svg")).toBeInTheDocument();
  });

  it("applies variant classes", () => {
    render(<Delta value={150} variant="badge" />);
    expect(screen.getByRole("status")).toHaveClass("rounded-full");
  });
});

describe("MetricCard", () => {
  it("renders label, value, and delta", () => {
    render(
      <MetricCard
        label="Test Metric"
        value={1_234_567}
        delta={5.2}
        deltaAsPercent
      />
    );

    expect(screen.getByText("Test Metric")).toBeInTheDocument();
    expect(screen.getByText("1.234567 USDC")).toBeInTheDocument();
    expect(screen.getByText("+5.2%")).toBeInTheDocument();
  });

  it("renders sparkline when data provided", () => {
    render(
      <MetricCard
        label="Test"
        value={100}
        sparklineData={[100, 110, 105, 120]}
      />
    );

    expect(screen.getByRole("img", { name: /sparkline/i })).toBeInTheDocument();
  });

  it("applies status border color", () => {
    const { container } = render(
      <MetricCard label="Test" value={100} status="healthy" />
    );
    const card = container.querySelector('[role="listitem"]') ?? container.firstChild;
    expect(card).toHaveClass("border-l-green-500");
  });

  it("formats value with custom formatter", () => {
    render(
      <MetricCard
        label="Test"
        value={1_234_567}
        formatValue={(v) => `$${(v / 1_000_000).toFixed(2)}M`}
      />
    );
    expect(screen.getByText("$1.23M")).toBeInTheDocument();
  });
});

describe("MetricGrid", () => {
  it("renders grid of metric cards", () => {
    render(
      <MetricGrid
        metrics={[
          { label: "Metric 1", value: 100 },
          { label: "Metric 2", value: 200 },
          { label: "Metric 3", value: 300 },
        ]}
      />
    );

    expect(screen.getByText("Metric 1")).toBeInTheDocument();
    expect(screen.getByText("Metric 2")).toBeInTheDocument();
    expect(screen.getByText("Metric 3")).toBeInTheDocument();
  });

  it("applies responsive columns", () => {
    render(
      <MetricGrid
        metrics={[{ label: "M1", value: 1 }, { label: "M2", value: 2 }]}
        columns={{ base: 1, sm: 2, md: 3 }}
      />
    );

    const grid = screen.getByRole("list");
    expect(grid).toHaveClass("grid-cols-1");
    expect(grid).toHaveClass("sm:grid-cols-2");
    expect(grid).toHaveClass("md:grid-cols-3");
  });
});