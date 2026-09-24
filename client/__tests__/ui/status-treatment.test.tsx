import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusTreatment, StatusDot, StatusBadge, StatusBanner } from "@syncro/ui";

describe("StatusTreatment", () => {
  it("renders all status levels", () => {
    render(
      <div>
        <StatusTreatment level="healthy" label="Healthy" />
        <StatusTreatment level="degraded" label="Degraded" />
        <StatusTreatment level="failing" label="Failing" />
        <StatusTreatment level="unknown" label="Unknown" />
      </div>
    );

    expect(screen.getByText("Healthy")).toBeInTheDocument();
    expect(screen.getByText("Degraded")).toBeInTheDocument();
    expect(screen.getByText("Failing")).toBeInTheDocument();
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });

  it("renders dot variant with indicator", () => {
    render(<StatusTreatment variant="dot" level="healthy" label="Healthy" />);
    const dot = screen.getByRole("status", { name: /healthy/i });
    expect(dot).toBeInTheDocument();
  });

  it("renders badge variant", () => {
    render(<StatusTreatment variant="badge" level="healthy" label="Healthy" />);
    expect(screen.getByText("Healthy")).toBeInTheDocument();
  });

  it("renders banner variant with description", () => {
    render(
      <StatusTreatment
        variant="banner"
        level="healthy"
        label="System Operational"
        description="All services running normally"
      />
    );

    expect(screen.getByText("System Operational")).toBeInTheDocument();
    expect(screen.getByText("All services running normally")).toBeInTheDocument();
  });

  it("renders inline variant", () => {
    render(<StatusTreatment variant="inline" level="healthy" label="Healthy" />);
    expect(screen.getByText("Healthy")).toBeInTheDocument();
  });

  it("shows pulse animation when enabled", () => {
    render(<StatusTreatment level="healthy" label="Live" pulse />);
    const dot = screen.getByRole("status", { name: /live/i });
    expect(dot).toHaveClass("animate-pulse");
  });

  it("has correct colors for each level", () => {
    const { container } = render(
      <div>
        <StatusTreatment variant="badge" level="healthy" label="Healthy" />
        <StatusTreatment variant="badge" level="degraded" label="Degraded" />
        <StatusTreatment variant="badge" level="failing" label="Failing" />
      </div>
    );

    const badges = container.querySelectorAll('[role="status"]');
    expect(badges[0]).toHaveClass("bg-green-50");
    expect(badges[1]).toHaveClass("bg-amber-50");
    expect(badges[2]).toHaveClass("bg-red-50");
  });

  it("supports custom label", () => {
    render(<StatusTreatment level="healthy" label="Custom Status" />);
    expect(screen.getByText("Custom Status")).toBeInTheDocument();
  });

  it("supports size variants", () => {
    render(
      <div>
        <StatusTreatment size="sm" level="healthy" label="Small" />
        <StatusTreatment size="md" level="healthy" label="Medium" />
        <StatusTreatment size="lg" level="healthy" label="Large" />
      </div>
    );

    expect(screen.getByText("Small")).toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();
    expect(screen.getByText("Large")).toBeInTheDocument();
  });
});

describe("StatusDot", () => {
  it("renders dot for each level", () => {
    render(
      <div>
        <StatusDot level="healthy" />
        <StatusDot level="degraded" />
        <StatusDot level="failing" />
        <StatusDot level="unknown" />
      </div>
    );

    const dots = screen.getAllByRole("status");
    expect(dots).toHaveLength(4);
  });

  it("has correct colors", () => {
    const { container } = render(
      <div>
        <StatusDot level="healthy" />
        <StatusDot level="degraded" />
        <StatusDot level="failing" />
      </div>
    );

    const dots = container.querySelectorAll('[role="status"] > span');
    expect(dots[0]).toHaveClass("bg-green-500");
    expect(dots[1]).toHaveClass("bg-amber-500");
    expect(dots[2]).toHaveClass("bg-red-500");
  });

  it("supports pulse animation", () => {
    render(<StatusDot level="healthy" pulse />);
    const dot = screen.getByRole("status", { name: /healthy/i });
    expect(dot.querySelector("span")).toHaveClass("animate-pulse");
  });

  it("supports size variants", () => {
    render(
      <div>
        <StatusDot level="healthy" size="sm" />
        <StatusDot level="healthy" size="md" />
        <StatusDot level="healthy" size="lg" />
      </div>
    );

    const dots = screen.getAllByRole("status");
    expect(dots[0]).toHaveClass("w-1.5 h-1.5");
    expect(dots[1]).toHaveClass("w-2 h-2");
    expect(dots[2]).toHaveClass("w-3 h-3");
  });
});

describe("StatusBadge", () => {
  it("renders badge for each level", () => {
    render(
      <div>
        <StatusBadge level="healthy" label="Active" />
        <StatusBadge level="degraded" label="Warning" />
        <StatusBadge level="failing" label="Error" />
        <StatusBadge level="unknown" label="Pending" />
      </div>
    );

    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Warning")).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });
});

describe("StatusBanner", () => {
  it("renders banner with action", () => {
    render(
      <StatusBanner
        level="failing"
        label="Major Outage"
        description="Service unavailable"
        action={<button>View Details</button>}
      />
    );

    expect(screen.getByText("Major Outage")).toBeInTheDocument();
    expect(screen.getByText("Service unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View Details" })).toBeInTheDocument();
  });
});