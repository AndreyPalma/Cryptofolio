/**
 * Tests for SubmitBar component (US-011 Phase 5)
 * TDD: T19.R — write failing test first
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SubmitBar } from "../src/components/add-transaction/SubmitBar";

describe("SubmitBar", () => {
  it("Submit button has disabled attribute when disabled === true", () => {
    const { container } = render(
      <SubmitBar submitting={false} disabled={true} errorMessage={null} />,
    );

    const btn = container.querySelector("button[type='submit']") as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(true);
  });

  it("Submit button is enabled when disabled === false and not submitting", () => {
    const { container } = render(
      <SubmitBar submitting={false} disabled={false} errorMessage={null} />,
    );

    const btn = container.querySelector("button[type='submit']") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("button text changes to loading indicator when submitting === true", () => {
    const { container } = render(
      <SubmitBar submitting={true} disabled={false} errorMessage={null} />,
    );

    const btn = container.querySelector("button[type='submit']")!;
    expect(btn.textContent).toContain("Saving");
  });

  it("renders <p role='alert'> with error text when errorMessage is non-null", () => {
    const { container } = render(
      <SubmitBar
        submitting={false}
        disabled={false}
        errorMessage="Could not save transaction. Try again."
      />,
    );

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain("Could not save transaction");
  });

  it("no alert element when errorMessage is null", () => {
    const { container } = render(
      <SubmitBar submitting={false} disabled={false} errorMessage={null} />,
    );

    const alert = container.querySelector('[role="alert"]');
    expect(alert).toBeNull();
  });

  it("button is disabled when submitting === true regardless of disabled prop", () => {
    const { container } = render(
      <SubmitBar submitting={true} disabled={false} errorMessage={null} />,
    );

    const btn = container.querySelector("button[type='submit']") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
