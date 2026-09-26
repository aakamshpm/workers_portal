import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { AwaitingItem, Offer } from "../shared/types";

/**
 * Worker home page in the worker's language. ADR-0015.
 *
 * What these tests guarantee:
 * - the offer, its buttons and its status badge are in the worker's language,
 *   because this is the screen where he locks the daily pay;
 * - the SMS reply hint keeps YES and the 4-digit reference unchanged, because
 *   the server reads only those words in a reply;
 * - the "please check" row and its OK / WRONG hint are in his language;
 * - the money and the day count are the real figures, not lost in translation.
 *
 * The API module is mocked. No test reaches the server.
 */

vi.mock("../shared/api", () => ({
  api: {
    offers: vi.fn(),
    awaiting: vi.fn(),
    balances: vi.fn(),
    disagreements: vi.fn(),
    respondToOffer: vi.fn(),
    confirmRecord: vi.fn(),
  },
}));

import { api } from "../shared/api";
import { DICTIONARIES, I18nProvider, translate } from "../shared/i18n";
import WorkerDashboard from "./WorkerDashboard";

const mocked = vi.mocked(api);
const bn = DICTIONARIES.bn;

const OFFER: Offer = {
  id: "o1",
  status: "PENDING",
  dailyRate: 900,
  workType: "Mason",
  siteName: "Aluva site",
  startDate: "2026-10-01T00:00:00.000Z",
  expectedDays: 20,
  extraTerms: null,
  createdAt: "2026-09-26T00:00:00.000Z",
  respondedAt: null,
  respondedVia: null,
  declineReason: null,
  worker: { id: "w", name: "Ramu" },
  contractor: { id: "c", name: "Joseph", company: "JV Builders" },
  ref: "4821",
};

const WORK: AwaitingItem = {
  kind: "WORK",
  id: "wp1",
  offerId: "o0",
  siteName: "Kakkanad site",
  contractorName: "Joseph",
  company: null,
  recordedAt: "2026-09-25T00:00:00.000Z",
  ref: "7314",
  note: null,
  days: 6,
  fromDate: "2026-09-19T00:00:00.000Z",
  toDate: "2026-09-24T00:00:00.000Z",
  worth: 5400,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocked.offers.mockResolvedValue([OFFER]);
  mocked.awaiting.mockResolvedValue([WORK]);
  mocked.balances.mockResolvedValue([]);
  mocked.disagreements.mockResolvedValue([]);
});

function renderIn(language: "bn" | "en") {
  render(
    <I18nProvider initial={language}>
      <WorkerDashboard user={{ id: "w", name: "Ramu", phone: "9845687924", role: "WORKER" }} />
    </I18nProvider>,
  );
}

describe("worker home in Bengali", () => {
  it("shows the offer, its buttons and its badge in Bengali", async () => {
    renderIn("bn");
    expect(await screen.findByText(bn.offerTitle)).toBeTruthy();
    expect(screen.getByRole("button", { name: bn.yesTakeWork })).toBeTruthy();
    expect(screen.getByRole("button", { name: bn.noDontWant })).toBeTruthy();
    expect(screen.getByText(bn.offerPending)).toBeTruthy();
    expect(screen.queryByText(/Yes, I will take this work/)).toBeNull();
  });

  it("keeps YES and the reference in the SMS hint", async () => {
    renderIn("bn");
    const hint = await screen.findByText(translate("bn", "replyYesSms", { ref: "4821" }));
    expect(hint.textContent).toMatch(/\bYES 4821\b/);
  });

  it("shows the real total pay for the offer", async () => {
    renderIn("bn");
    await screen.findByText(bn.offerTitle);
    expect(document.body.textContent).toContain("₹18,000");
  });

  it("shows the work row to check, with OK and WRONG kept, in Bengali", async () => {
    renderIn("bn");
    expect(await screen.findByText(translate("bn", "heSaysDays", { days: "6" }))).toBeTruthy();
    expect(screen.getByRole("button", { name: bn.yesCorrect })).toBeTruthy();
    const hint = screen.getByText(translate("bn", "replyOkWrongSms", { ref: "7314" }));
    expect(hint.textContent).toMatch(/\bOK 7314\b/);
    expect(hint.textContent).toMatch(/\bWRONG 7314\b/);
  });

  it("asks for his own number in Bengali when he says the days are wrong", async () => {
    renderIn("bn");
    fireEvent.click(await screen.findByRole("button", { name: bn.noNotCorrect }));
    // The field's label element also holds the hint, so match the question as a part.
    expect(screen.getByLabelText(bn.realDays, { exact: false })).toBeTruthy();
    expect(screen.getByRole("button", { name: bn.sendMyAnswer })).toBeTruthy();
  });
});

describe("worker home in English", () => {
  it("still reads as before", async () => {
    renderIn("en");
    expect(await screen.findByRole("button", { name: "Yes, I will take this work" })).toBeTruthy();
    expect(screen.getByText("He says you worked this many days: 6")).toBeTruthy();
  });
});
