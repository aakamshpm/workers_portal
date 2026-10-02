import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ContractBalance } from "../types";
import { DICTIONARIES, I18nProvider, translate } from "../i18n";
import BalanceCard from "./BalanceCard";

/**
 * One contract with its money worked out (W1, "Your work").
 *
 * What these tests guarantee:
 * - in the worker app every word on the card is in the worker's language,
 *   because this is the card that tells him what he is owed (ADR-0015);
 * - the contractor and officer apps keep the English that speaks about "the
 *   worker", not to him;
 * - the amount still to be paid is the largest figure, on its own line, so it
 *   never floats beside the site name on a narrow phone;
 * - nothing uses a colour outside the theme.
 */

const BALANCE: ContractBalance = {
  offerId: "o1",
  status: "ACCEPTED",
  worker: { id: "w", name: "Bijoy Das" },
  contractor: { id: "c", name: "Ramesh Pillai", company: "Ramesh Builders" },
  dailyRate: 850,
  workType: "Construction - steel binding",
  siteName: "Kakkanad Phase 2",
  startDate: "2026-07-06T00:00:00.000Z",
  expectedDays: 30,
  extraTerms: null,
  acceptedAt: "2026-07-04T00:00:00.000Z",
  acceptedVia: "SMS",
  daysWorked: 23,
  earned: 19550,
  paid: 16000,
  balance: 3550,
  daysConfirmed: 17.5,
  daysWaiting: 5.5,
  daysDisputed: 0,
  earnedConfirmed: 14875,
  paidConfirmed: 16000,
  paidWaiting: 0,
  paidDisputed: 0,
  awaitingConfirmation: 1,
  disputedRecords: 0,
  periodCount: 4,
  paymentCount: 2,
  lastPaymentOn: null,
  openComplaints: 0,
} as ContractBalance;

function inLanguage(language: "ml" | "en") {
  return render(
    <I18nProvider initial={language}>
      <BalanceCard balance={BALANCE} viewer="WORKER" />
    </I18nProvider>,
  );
}

describe("BalanceCard for the worker", () => {
  it("is in Malayalam for a worker who reads Malayalam", () => {
    const ml = DICTIONARIES.ml;
    inLanguage("ml");
    const text = document.body.textContent ?? "";
    for (const key of ["balStillToPay", "balDayRate", "balDaysWritten", "balEarned", "balPaid", "balNoAnswerYet"] as const) {
      expect(text, key).toContain(ml[key]);
    }
    expect(text).toContain(translate("ml", "balYouSaidAbout", { days: "23" }));
    expect(text).not.toMatch(/Still to be paid|Pay for one day|No answer yet/);
  });

  it("shows the money still owed as the card's largest figure", () => {
    inLanguage("en");
    const owed = screen.getByText("₹3,550");
    expect(owed.className).toContain("text-stat-callout");
  });

  it("writes no colour outside the theme", () => {
    const { container } = inLanguage("en");
    expect(container.innerHTML).not.toMatch(/slate-|rose-|emerald-|amber-|sky-/);
  });
});

describe("BalanceCard for the contractor and officer", () => {
  it("speaks about the worker, in English", () => {
    render(<BalanceCard balance={BALANCE} viewer="CONTRACTOR" />);
    expect(document.body.textContent).toContain("What the worker said about these 23 days");
    expect(document.body.textContent).toContain("Worker said yes");
  });
});
