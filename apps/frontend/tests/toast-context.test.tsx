/**
 * Tests for ToastContext (US-011 Phase 1)
 * TDD: T3.R — write failing test first
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { render, act } from "@testing-library/react";
import { ToastProvider, useToast } from "../src/lib/toast-context";

// Helper component that uses useToast
function ShowToastButton({ message, variant }: { message: string; variant?: "success" | "error" }) {
  const { show } = useToast();
  return (
    <button onClick={() => show(message, variant)}>
      Show Toast
    </button>
  );
}

// Helper component that renders outside provider (for error test)
function OutsideProvider() {
  try {
    useToast();
    return <div>no error</div>;
  } catch (e) {
    return <div>{(e as Error).message}</div>;
  }
}

describe("useToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("throws when called outside <ToastProvider>", () => {
    const { container } = render(<OutsideProvider />);
    expect(container.textContent).toContain("useToast must be used inside <ToastProvider>");
  });

  it("show() renders a toast in the DOM with the message", () => {
    const { container, getByText } = render(
      <ToastProvider>
        <ShowToastButton message="Hello toast" />
      </ToastProvider>,
    );

    const btn = getByText("Show Toast");
    act(() => {
      btn.click();
    });

    expect(container.textContent).toContain("Hello toast");
  });

  it("toast disappears after 3 seconds (auto-dismiss)", () => {
    const { container, getByText } = render(
      <ToastProvider>
        <ShowToastButton message="Bye bye" />
      </ToastProvider>,
    );

    const btn = getByText("Show Toast");
    act(() => {
      btn.click();
    });

    expect(container.textContent).toContain("Bye bye");

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(container.textContent).not.toContain("Bye bye");
  });

  it("second show() replaces first toast (only one at a time)", () => {
    function TwoButtons() {
      const { show } = useToast();
      return (
        <>
          <button onClick={() => show("First toast")}>First</button>
          <button onClick={() => show("Second toast")}>Second</button>
        </>
      );
    }

    const { container, getByText } = render(
      <ToastProvider>
        <TwoButtons />
      </ToastProvider>,
    );

    act(() => {
      getByText("First").click();
    });

    expect(container.textContent).toContain("First toast");

    act(() => {
      getByText("Second").click();
    });

    expect(container.textContent).not.toContain("First toast");
    expect(container.textContent).toContain("Second toast");
  });

  it("success variant uses role='status'", () => {
    const { container, getByText } = render(
      <ToastProvider>
        <ShowToastButton message="Success!" variant="success" />
      </ToastProvider>,
    );

    act(() => {
      getByText("Show Toast").click();
    });

    const statusEl = container.querySelector('[role="status"]');
    expect(statusEl).not.toBeNull();
    expect(statusEl?.textContent).toContain("Success!");
  });

  it("error variant uses role='alert'", () => {
    const { container, getByText } = render(
      <ToastProvider>
        <ShowToastButton message="Error!" variant="error" />
      </ToastProvider>,
    );

    act(() => {
      getByText("Show Toast").click();
    });

    const alertEl = container.querySelector('[role="alert"]');
    expect(alertEl).not.toBeNull();
    expect(alertEl?.textContent).toContain("Error!");
  });
});
