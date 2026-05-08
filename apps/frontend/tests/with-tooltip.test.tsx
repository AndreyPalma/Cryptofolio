/**
 * Tests for WithTooltip component (US-010 Phase 3)
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { WithTooltip } from "../src/components/token-detail/WithTooltip";

describe("WithTooltip", () => {
  it("SC-WT-01: text={null} renders children with no wrapper span", () => {
    const { container } = render(
      <WithTooltip text={null}>
        <span id="child">hello</span>
      </WithTooltip>,
    );
    // No wrapper span — just the child
    const child = container.querySelector("#child");
    expect(child).not.toBeNull();
    // The wrapper should be a fragment (React.Fragment), so no extra span
    expect(container.querySelector("[role='tooltip']")).toBeNull();
  });

  it("SC-WT-02: text='some tooltip' renders tooltip span with role='tooltip'", () => {
    const { container } = render(
      <WithTooltip text="some tooltip">
        <span>trigger</span>
      </WithTooltip>,
    );
    const tooltip = container.querySelector("[role='tooltip']");
    expect(tooltip).not.toBeNull();
    expect(tooltip?.textContent).toBe("some tooltip");
  });

  it("SC-WT-03: tooltip span has opacity-0 base class and group-hover:opacity-100", () => {
    const { container } = render(
      <WithTooltip text="test">
        <span>trigger</span>
      </WithTooltip>,
    );
    const tooltip = container.querySelector("[role='tooltip']");
    expect(tooltip?.className).toContain("opacity-0");
    expect(tooltip?.className).toContain("group-hover:opacity-100");
  });
});
