import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ContractBalance, PaymentRow } from "./../shared/types";

/**
 * Pay a worker (design C4, C7) on a 320px phone.
 *
 * What these tests guarantee:
 * - each job in the list is named by the worker and the site alone. The
 *   amount owed is shown in the note under the list, because a native list
 *   cuts a long option ("Aakamsh · Kannur · you ow") with no way to read it;
 * - the three ways of paying are one group of buttons, each a finger high,
 *   that share the width on a normal phone and stack below 360px, so
 *   "Cash, with a code" is never squeezed onto three lines;
 * - in the list of payments, the two badges sit together under the text and
 *   start at the same left edge in every row, instead of one at each side;
 * - a wrong code shows the server's message with the tries left, and keeps the
 *   code box so he can type it again (ADR-0024);
 * - a spent or expired code takes him back to the first step, so he can send
 *   a new code instead of typing into a code that can no longer work.
 *
 * The API module is mocked. No test reaches the server.
 */

vi.mock("../shared/api", async () => {
  const real = await vi.importActual<typeof import("../shared/api")>("../shared/api");
  return {
    ApiError: real.ApiError,
    api: { balances: vi.fn(), paymentHistory: vi.fn(), pendingCode: vi.fn(), confirmCode: vi.fn() },
  };
});

import { api, ApiError } from "../shared/api";
import PaymentProofPage from "./PaymentProofPage";

const BAL = {
  offerId: "o1", status: "ACCEPTED",
  worker: { id: "w", name: "Bijoy Das" }, contractor: { id: "c", name: "Ramesh Pillai", company: "Ramesh Builders" },
  dailyRate: 850, workType: "Steel binding", siteName: "Kakkanad Phase 2", startDate: "2026-07-06T00:00:00.000Z",
  expectedDays: 30, extraTerms: null, acceptedAt: "2026-07-04T00:00:00.000Z", acceptedVia: "SMS",
  daysWorked: 23, earned: 19550, paid: 16000, balance: 3550, daysConfirmed: 17.5, daysWaiting: 5.5, daysDisputed: 0,
  earnedConfirmed: 14875, paidConfirmed: 16000, paidWaiting: 0, paidDisputed: 0, awaitingConfirmation: 1,
  disputedRecords: 0, periodCount: 4, paymentCount: 2, lastPaymentOn: null, openComplaints: 0,
} as ContractBalance;

const PAYMENT = {
  id: "p1", offerId: "o1", siteName: "Kakkanad Phase 2",
  worker: { id: "w", name: "Bijoy Das" }, contractor: { id: "c", name: "Ramesh Pillai" },
  amount: 8000, paidOn: "2026-08-01T00:00:00.000Z", method: "CASH", note: null,
  confirmState: "CONFIRMED", confirmedVia: "SMS", workerClaimsAmount: null, disputeNote: null,
  proofType: "NONE", proofReference: null, proofAt: null, evidence: "weak",
} as PaymentRow;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.balances).mockResolvedValue([BAL]);
  vi.mocked(api.paymentHistory).mockResolvedValue([PAYMENT]);
  vi.mocked(api.pendingCode).mockResolvedValue(null);
});

describe("Pay a worker on a phone", () => {
  it("names each job by worker and site, and shows what is owed in the note under the list", async () => {
    render(<PaymentProofPage />);
    const list = await screen.findByRole("combobox", { name: "Worker being paid" });
    const option = within(list).getByRole("option");
    expect(option.textContent).toBe("Bijoy Das · Kakkanad Phase 2");
    expect(screen.getByText(/leaving/).textContent).toContain("₹3,550");
  });

  it("offers the three ways of paying as one group of buttons a finger high", async () => {
    render(<PaymentProofPage />);
    const group = await screen.findByRole("group", { name: "How you paid" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Cash, with a code", "UPI or bank", "Cash, no proof"]);
    expect(buttons[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(buttons[1]!.getAttribute("aria-pressed")).toBe("false");
    for (const b of buttons) expect(b.className).toContain("min-h-[var(--size-touch)]");
    // Three columns on a normal phone, one column below 360px.
    expect(group.className).toContain("grid-cols-3");
    expect(group.className).toContain("max-[359px]:grid-cols-1");
  });

  it("puts both badges of a payment together under its text, aligned to the left", async () => {
    render(<PaymentProofPage />);
    const proof = await screen.findByText("Worker agreed later");
    const agree = screen.getByText("Both agree");
    expect(proof.parentElement).toBe(agree.parentElement);
    const row = proof.parentElement!;
    expect(row.className).toContain("flex-wrap");
    expect(row.className).not.toContain("items-end");
    expect(row.className).not.toContain("justify-between");
  });

  it("uses no colour outside the theme in the method group", async () => {
    render(<PaymentProofPage />);
    const group = await screen.findByRole("group", { name: "How you paid" });
    expect(group.outerHTML).not.toMatch(/slate-|rose-|sky-|amber-/);
  });

  describe("typing the code the worker reads out", () => {
    const PENDING = {
      offerId: "o1", amount: 2000, expiresAt: "2026-10-17T10:15:00.000Z", workerId: "w",
      worker: { name: "Bijoy Das", phone: "9880030001" },
    };

    async function typeCode(code: string) {
      const box = await screen.findByRole("textbox", { name: "Enter the code the worker reads out" });
      fireEvent.change(box, { target: { value: code } });
      fireEvent.click(screen.getByRole("button", { name: "Verify code" }));
      return box;
    }

    it("shows the tries left after a wrong code, and keeps the code box", async () => {
      vi.mocked(api.pendingCode).mockResolvedValue(PENDING);
      vi.mocked(api.confirmCode).mockRejectedValue(
        new ApiError("That code is wrong. 3 tries left. Ask the worker to read it again.", "CODE_WRONG", 400, { triesLeft: 3 }),
      );
      render(<PaymentProofPage />);
      await typeCode("1111");
      expect(await screen.findByText(/3 tries left/)).toBeTruthy();
      expect(screen.getByRole("textbox", { name: "Enter the code the worker reads out" })).toBeTruthy();
    });

    for (const code of ["CODE_SPENT", "CODE_EXPIRED", "NO_CODE"]) {
      it(`goes back to sending a new code after ${code}`, async () => {
        vi.mocked(api.pendingCode).mockResolvedValueOnce(PENDING).mockResolvedValue(null);
        vi.mocked(api.confirmCode).mockRejectedValue(
          new ApiError("This code no longer works. Send a new code to the worker.", code, 409),
        );
        render(<PaymentProofPage />);
        await typeCode("1111");
        expect(await screen.findByText(/no longer works/)).toBeTruthy();
        await waitFor(() =>
          expect(screen.queryByRole("textbox", { name: "Enter the code the worker reads out" })).toBeNull(),
        );
        expect(screen.getByRole("button", { name: "Send code to the worker's phone" })).toBeTruthy();
      });
    }
  });
});
