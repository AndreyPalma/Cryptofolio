/**
 * Tests for SkeletonRow component
 * Phase 4 — RED
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SkeletonRow } from "../src/components/dashboard/SkeletonRow";

describe("SkeletonRow", () => {
  it("renders a <tr> element", () => {
    const { container } = render(
      <table>
        <tbody>
          <SkeletonRow />
        </tbody>
      </table>,
    );
    const tr = container.querySelector("tr");
    expect(tr).not.toBeNull();
  });

  it("contains exactly 11 <td> cells", () => {
    const { container } = render(
      <table>
        <tbody>
          <SkeletonRow />
        </tbody>
      </table>,
    );
    const tds = container.querySelectorAll("td");
    expect(tds.length).toBe(11);
  });

  it("each <td> contains an element with animate-pulse class", () => {
    const { container } = render(
      <table>
        <tbody>
          <SkeletonRow />
        </tbody>
      </table>,
    );
    const tds = container.querySelectorAll("td");
    tds.forEach((td) => {
      const animated = td.querySelector(".animate-pulse");
      expect(animated).not.toBeNull();
    });
  });
});
