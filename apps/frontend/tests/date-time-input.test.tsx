/**
 * Tests for DateTimeInput component (US-011 Phase 4)
 * TDD: T14.R — write failing test first
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { DateTimeInput } from "../src/components/add-transaction/DateTimeInput";

describe("DateTimeInput", () => {
  it("renders an <input type='datetime-local'>", () => {
    const { container } = render(
      <DateTimeInput value="2025-05-08T14:30" onChange={() => undefined} />,
    );

    const input = container.querySelector("input[type='datetime-local']");
    expect(input).not.toBeNull();
  });

  it("value prop controls the displayed value", () => {
    const { container } = render(
      <DateTimeInput value="2025-05-08T14:30" onChange={() => undefined} />,
    );

    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("2025-05-08T14:30");
  });

  it("onChange fires with the input's value string", () => {
    const onChange = vi.fn();
    const { container } = render(
      <DateTimeInput value="" onChange={onChange} />,
    );

    const input = container.querySelector("input")!;
    fireEvent.change(input, { target: { value: "2025-05-08T14:30" } });

    expect(onChange).toHaveBeenCalledWith("2025-05-08T14:30");
  });
});
