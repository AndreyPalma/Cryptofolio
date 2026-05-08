/**
 * Tests for InheritWacSuggestion component (US-011 Phase 5)
 * TDD: T18.R — write failing test first
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { InheritWacSuggestion } from "../src/components/add-transaction/InheritWacSuggestion";

describe("InheritWacSuggestion", () => {
  it("renders null when candidate === null and loading === false", () => {
    const { container } = render(
      <InheritWacSuggestion candidate={null} loading={false} onUse={() => undefined} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a loading indicator when loading === true and candidate === null", () => {
    const { container } = render(
      <InheritWacSuggestion candidate={null} loading={true} onUse={() => undefined} />,
    );
    // Some indication of loading
    expect(container.textContent?.trim().length).toBeGreaterThan(0);
  });

  it("renders 'Inherit WAC' message with wac and label when candidate is present", () => {
    const { container } = render(
      <InheritWacSuggestion
        candidate={{ walletId: "w2", label: "Cold Wallet ETH", wac: "1800.50" }}
        loading={false}
        onUse={() => undefined}
      />,
    );
    expect(container.textContent).toContain("Inherit WAC");
    expect(container.textContent).toContain("1800.50");
    expect(container.textContent).toContain("Cold Wallet ETH");
  });

  it("renders a 'Use this' button when candidate is present", () => {
    const { container } = render(
      <InheritWacSuggestion
        candidate={{ walletId: "w2", label: "Cold Wallet", wac: "1800.50" }}
        loading={false}
        onUse={() => undefined}
      />,
    );

    const btn = container.querySelector("button");
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toContain("Use this");
  });

  it("clicking 'Use this' calls onUse with the wac value", () => {
    const onUse = vi.fn();
    const { container } = render(
      <InheritWacSuggestion
        candidate={{ walletId: "w2", label: "Cold Wallet", wac: "1800.50" }}
        loading={false}
        onUse={onUse}
      />,
    );

    const btn = container.querySelector("button")!;
    fireEvent.click(btn);

    expect(onUse).toHaveBeenCalledWith("1800.50");
  });

  it("uses fallback label when candidate.label could be a generic string", () => {
    const { container } = render(
      <InheritWacSuggestion
        candidate={{ walletId: "w2", label: "Unknown Wallet", wac: "1800.50" }}
        loading={false}
        onUse={() => undefined}
      />,
    );
    expect(container.textContent).toContain("Unknown Wallet");
  });
});
