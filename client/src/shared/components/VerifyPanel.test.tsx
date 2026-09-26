import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { VerificationResult } from "../types";

/**
 * The integrity check panel. Contract: docs/contracts/ledger.md. ADR-0013.
 *
 * What these tests guarantee:
 * - when the only problems are in other people's records, the panel says the
 *   records are not all intact, and does not claim "0 lines changed";
 * - it never says "nothing has been changed" while any problem exists,
 *   including problems the reader is not allowed to see.
 *
 * The API module is mocked. No test reaches the server.
 */

vi.mock("../api", () => ({ api: { verify: vi.fn() } }));

import { api } from "../api";
import VerifyPanel from "./VerifyPanel";

const mocked = vi.mocked(api);

function result(over: Partial<VerificationResult>): VerificationResult {
  return {
    valid: true,
    entriesChecked: 49,
    failures: [],
    hiddenFailures: 0,
    checkedAt: "2026-09-26T08:00:00.000Z",
    ...over,
  };
}

beforeEach(() => vi.resetAllMocks());

async function check() {
  render(<VerifyPanel />);
  fireEvent.click(screen.getByRole("button", { name: /check all records/i }));
  await screen.findByText(/we checked at/i);
  return document.body.textContent ?? "";
}

describe("VerifyPanel", () => {
  it("says nothing was changed when the whole chain is intact", async () => {
    mocked.verify.mockResolvedValue(result({}));
    expect(await check()).toMatch(/nothing has been changed/i);
  });

  it("reports a problem in someone else's records without claiming 0 lines changed", async () => {
    mocked.verify.mockResolvedValue(result({ valid: false, failures: [], hiddenFailures: 2 }));
    const text = await check();
    expect(text).not.toMatch(/nothing has been changed/i);
    expect(text).not.toMatch(/changed 0 line/i);
    expect(text).toMatch(/2 problems/i);
    expect(text).toMatch(/not yours/i);
  });

  it("says your own records are fine when every problem is elsewhere", async () => {
    mocked.verify.mockResolvedValue(result({ valid: false, failures: [], hiddenFailures: 1 }));
    expect(await check()).toMatch(/your own records are unchanged/i);
  });
});
