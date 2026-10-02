import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import DigitBoxes from "./DigitBoxes";

/**
 * The look of the digit boxes (ADR-0019). Their behaviour, moving between
 * boxes, Backspace, pasting a whole code, is tested on the sign-in page, where
 * it is used.
 *
 * What this guarantees: each box is the design's 56px tall, and on a narrow
 * phone six boxes shrink to fit the width instead of running off the screen.
 */
describe("DigitBoxes", () => {
  const boxes = () => screen.getAllByRole("textbox") as HTMLInputElement[];

  it("is the design's height", () => {
    render(<DigitBoxes label="Code" length={6} value="" onChange={() => {}} />);
    for (const b of boxes()) expect(b.className).toContain("h-[var(--size-digit-box)]");
  });

  it("shares the width, so six boxes fit a 320px phone instead of running off it", () => {
    // Six 48px boxes and five 8px gaps are 328px, and a 320px phone has 288px
    // inside its margins. So a box may be narrower than 48px; it keeps its
    // 56px height, which is the part a thumb lands on.
    render(<DigitBoxes label="Code" length={6} value="" onChange={() => {}} />);
    for (const b of boxes()) {
      expect(b.className).toContain("flex-1");
      expect(b.className).toContain("min-w-0");
      expect(b.className).not.toContain("min-w-[var(--size-touch)]");
      expect(b.className).toContain("max-w-[var(--size-digit-box)]");
    }
  });

  it("marks a filled box, so the worker sees how many digits are left", () => {
    render(<DigitBoxes label="Code" length={6} value="48" onChange={() => {}} />);
    const [first, second, third] = boxes();
    expect(first!.className).toContain("bg-surface-container-high");
    expect(second!.className).toContain("bg-surface-container-high");
    expect(third!.className).not.toContain("bg-surface-container-high");
  });

  it("has an edge a reader can see on the page background", () => {
    // White on the page is about 1.05:1, which is no edge. WCAG 1.4.11 asks
    // for 3:1 on a control's boundary, and only `outline` reaches it.
    // Checked on PIN boxes, which are password inputs. A password input has no
    // "textbox" role, so they are found by their label instead.
    render(<DigitBoxes label="PIN" length={4} value="" onChange={() => {}} secret />);
    const pinBoxes = screen.getAllByLabelText(/PIN digit/) as HTMLInputElement[];
    expect(pinBoxes).toHaveLength(4);
    for (const b of pinBoxes) expect(b.className.split(/\s+/)).toContain("ring-outline");
  });

  it("writes no colour of its own", () => {
    const { container } = render(<DigitBoxes label="PIN" length={4} value="" onChange={() => {}} secret />);
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(container.innerHTML).not.toMatch(/slate-|rose-|emerald-|sky-/);
  });
});
