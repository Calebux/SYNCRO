import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sparkline, SparklineWithValue } from "@syncro/ui";

describe("Sparkline", () => {
  it("renders SVG for line variant", () => {
    render(<Sparkline data={[100, 110, 105, 120]} variant="line" />);
    const svg = screen.getByRole("img");
    expect(svg).toBeInTheDocument();
    expect(svg.tagName).toBe("SVG");
  });

  it("renders SVG for area variant", () => {
    render(<Sparkline data={[100, 110, 105, 120]} variant="area" />);
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("renders SVG for bar variant", () => {
    render(<Sparkline data={[100, 110, 105, 120]} variant="bar" />);
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("applies tone colors", () => {
    const { container } = render(
      <Sparkline data={[100, 110, 105, 120]} variant="line" tone="positive" />
    );
    const path = container.querySelector("path");
    expect(path).toHaveAttribute("stroke", "#22c55e");
  });

  it("shows last point when enabled", () => {
    const { container } = render(
      <Sparkline data={[100, 110, 105, 120]} variant="line" showLastPoint />
    );
    const circles = container.querySelectorAll("circle");
    expect(circles.length).toBeGreaterThan(0);
  });

  it("hides last point when disabled", () => {
    const { container } = render(
      <Sparkline data={[100, 110, 105, 120]} variant="line" showLastPoint={false} />
    );
    const circles = container.querySelectorAll("circle");
    expect(circles.length).toBe(0);
  });

  it("applies size variants", () => {
    const { container } = render(
      <Sparkline data={[100, 110, 105, 120]} variant="line" size="sm" />
    );
    const svg = container.querySelector("svg");
    expect(svg).toHaveClass("h-4");
    expect(svg).toHaveClass("w-16");
  });

  it("handles empty data gracefully", () => {
    render(<Sparkline data={[]} variant="line" />);
    const svg = screen.getByRole("img");
    expect(svg).toBeInTheDocument();
  });

  it("handles single data point", () => {
    render(<Sparkline data={[100]} variant="line" />);
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("includes aria-label", () => {
    render(<Sparkline data={[100, 110]} variant="line" ariaLabel="Custom label" />);
    const svg = screen.getByRole("img");
    expect(svg).toHaveAttribute("aria-label", "Custom label");
  });

  it("auto-generates aria-label from data", () => {
    render(<Sparkline data={[100, 110, 105]} variant="line" />);
    const svg = screen.getByRole("img");
    expect(svg).toHaveAttribute("aria-label", expect.stringContaining("3 data points"));
  });

  it("disables animation when duration is 0", () => {
    const { container } = render(
      <Sparkline data={[100, 110]} variant="line" animationDuration={0} />
    );
    const path = container.querySelector("path");
    expect(path).not.toHaveClass("sparkline-path");
  });
});

describe("SparklineWithValue", () => {
  it("renders value and sparkline", () => {
    render(
      <SparklineWithValue
        label="Revenue"
        value={12_345.67}
        data={[100, 110, 105, 120]}
      />
    );

    expect(screen.getByText("Revenue")).toBeInTheDocument();
    expect(screen.getByText("12,345.67")).toBeInTheDocument();
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("renders delta when provided", () => {
    render(
      <SparklineWithValue
        label="Revenue"
        value={12_345.67}
        data={[100, 110, 105, 120]}
        delta={5.2}
        deltaAsPercent
      />
    );

    expect(screen.getByText("+5.2%")).toBeInTheDocument();
  });

  it("uses custom value formatter", () => {
    render(
      <SparklineWithValue
        label="Revenue"
        value={1_234_567}
        data={[100, 110, 105, 120]}
        formatValue={(v) => `$${(v / 1_000_000).toFixed(2)}M`}
      />
    );

    expect(screen.getByText("$1.23M")).toBeInTheDocument();
  });

  it("determines tone from delta", () => {
    const { container } = render(
      <SparklineWithValue
        label="Test"
        value={100}
        data={[100, 110, 105, 120]}
        delta={-5}
      />
    );
    const svg = container.querySelector("svg");
    expect(svg).toHaveClass("text-red-600");
  });

  it("uses explicit tone when delta not provided", () => {
    const { container } = render(
      <SparklineWithValue
        label="Test"
        value={100}
        data={[100, 110, 105, 120]}
        tone="positive"
      />
    );
    const svg = container.querySelector("svg");
    expect(svg).toHaveClass("text-green-600");
  });
});