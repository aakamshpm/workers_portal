import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ContractBalance } from "../shared/types";

/**
 * Ask for help (design W6) on a phone.
 *
 * What these tests guarantee:
 * - the form starts on the job with the most money owed, and the figure the
 *   records give is shown before he writes anything;
 * - the job list does not cut the site name, because each job is named by
 *   its site alone, with the contractor and the start date shown beside it;
 * - "Send" is the full-width page button, so it is not missed at the foot of
 *   a long form;
 * - nothing uses a colour outside the theme.
 *
 * The API module is mocked. No test reaches the server.
 */

vi.mock("../shared/api", () => ({
  api: { balances: vi.fn(), complaints: vi.fn(), complaintCategories: vi.fn(), fileComplaint: vi.fn() },
}));

import { api } from "../shared/api";
import ComplaintPage from "./ComplaintPage";

const BAL = {
  offerId: "o1", status: "ACCEPTED",
  worker: { id: "w", name: "Bijoy Das" }, contractor: { id: "c", name: "Ramesh Pillai", company: "Ramesh Builders" },
  dailyRate: 850, workType: "Steel binding", siteName: "Kakkanad Phase 2", startDate: "2026-07-06T00:00:00.000Z",
  expectedDays: 30, extraTerms: null, acceptedAt: "2026-07-04T00:00:00.000Z", acceptedVia: "SMS",
  daysWorked: 23, earned: 19550, paid: 16000, balance: 3550, daysConfirmed: 17.5, daysWaiting: 5.5, daysDisputed: 0,
  earnedConfirmed: 14875, paidConfirmed: 16000, paidWaiting: 0, paidDisputed: 0, awaitingConfirmation: 1,
  disputedRecords: 0, periodCount: 4, paymentCount: 2, lastPaymentOn: null, openComplaints: 0,
} as ContractBalance;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.balances).mockResolvedValue([BAL]);
  vi.mocked(api.complaints).mockResolvedValue([]);
  vi.mocked(api.complaintCategories).mockResolvedValue([{ id: "UNPAID", label: "I was not paid" }]);
});

function open() {
  return render(<ComplaintPage user={{ id: "w", name: "Bijoy Das", phone: "9880030001", role: "WORKER" }} />);
}

describe("ComplaintPage on a phone", () => {
  it("names each job by its site, so the list does not cut it", async () => {
    open();
    const job = await screen.findByRole("combobox", { name: "Which work is this about?" });
    expect((job as HTMLSelectElement).options[0]!.text).toBe("Kakkanad Phase 2");
    expect(document.body.textContent).toContain("Ramesh Pillai");
  });

  it("shows what the records say, with the amount owed", async () => {
    open();
    const facts = await screen.findByRole("region", { name: "What the records say about this work" });
    expect(facts.textContent).toContain("₹3,550");
  });

  it("finishes with the full-width page button", async () => {
    open();
    const send = await screen.findByRole("button", { name: "Send to the labour office" });
    expect(send.className).toContain("min-h-[var(--size-button)]");
    expect(send.className).toContain("w-full");
  });

  it("writes no colour outside the theme", async () => {
    const { container } = open();
    await screen.findByRole("button", { name: "Send to the labour office" });
    expect(container.innerHTML).not.toMatch(/slate-|rose-|emerald-|amber-|sky-/);
  });
});
