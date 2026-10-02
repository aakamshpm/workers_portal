import type { ReactNode } from "react";
import type { ContractBalance } from "../types";
import { useT } from "../i18n";
import { Card, formatDays, formatRupees, Note } from "./ui";

/**
 * One accepted contract, with the money worked out.
 *
 * The layout deliberately separates two different things: what the contractor
 * recorded, and what the worker has agreed to. A single "you are owed X" figure
 * would read as a fact when part of it may be one person's unchecked claim.
 *
 * On the worker's own card every word is in his language (ADR-0015), and the
 * card speaks to him. The contractor and officer read about the worker, in
 * English, so their wording names him instead.
 */
export default function BalanceCard({
  balance,
  viewer,
  footer,
}: {
  balance: ContractBalance;
  viewer: "WORKER" | "CONTRACTOR" | "AUTHORITY";
  footer?: ReactNode;
}) {
  const { t } = useT();
  const owed = balance.balance;
  const isWorker = viewer === "WORKER";
  const other = isWorker ? balance.contractor : balance.worker;

  const hasUnchecked = balance.awaitingConfirmation > 0;
  const hasDisputed = balance.disputedRecords > 0;

  // What the figure is worth if only the worker-agreed records are counted. When
  // everything is confirmed this equals `owed`, and the second line is hidden.
  const confirmedOwed = balance.earnedConfirmed - balance.paidConfirmed;
  const days = (n: number) => (isWorker ? t("balDays", { days: formatDays(n) }) : `${formatDays(n)} day${n === 1 ? "" : "s"}`);

  const text = isWorker
    ? {
        stillToPay: t("balStillToPay"),
        paidTooMuch: t("balPaidTooMuch"),
        nothingLeft: t("balNothingLeft"),
        dayRate: t("balDayRate"),
        daysWritten: t("balDaysWritten"),
        earned: t("balEarned"),
        paid: t("balPaid"),
        saidAbout: t("balYouSaidAbout", { days: formatDays(balance.daysWorked) }),
        saidYes: t("balYouSaidYes"),
        noAnswer: t("balNoAnswerYet"),
        saidNo: t("balYouSaidNo"),
        confirmedOwed: (a: string) => t("balConfirmedOwed", { amount: a }),
        confirmedOverpaid: (a: string) => t("balConfirmedOverpaid", { amount: a }),
        confirmedNothing: t("balConfirmedNothing"),
        disputed: t("balDisputedNote", { count: balance.disputedRecords }),
        paidDisputed: (a: string) => t("balPaidDisputed", { amount: a }),
      }
    : {
        stillToPay: "Still to be paid",
        paidTooMuch: "Paid too much",
        nothingLeft: "Nothing left to pay",
        dayRate: "Pay for one day",
        daysWritten: "Days written down",
        earned: "Earned in total",
        paid: "Already paid",
        saidAbout: `What the worker said about these ${formatDays(balance.daysWorked)} days`,
        saidYes: "Worker said yes",
        noAnswer: "No answer yet",
        saidNo: "Worker said no",
        confirmedOwed: (a: string) => `Counting only the days the worker said yes to, he is owed ${a}.`,
        confirmedOverpaid: (a: string) =>
          `Counting only the days the worker said yes to, he has already been paid ${a} more than those days come to.`,
        confirmedNothing: "Counting only the days the worker said yes to, nothing is left to pay.",
        disputed: `The worker said no to ${balance.disputedRecords} record${balance.disputedRecords === 1 ? "" : "s"} here. The labour office can see this even if he never makes a complaint.`,
        paidDisputed: (a: string) =>
          `The worker says he never got ${a} of the money written down here, so that part is not settled.`,
      };

  return (
    <Card>
      {/* The amount owed is on its own line under the site, never beside it,
          so a long site name and the figure do not fight for one narrow row. */}
      <div className="flex flex-col gap-space-sm border-b border-outline-variant px-space-lg py-space-md">
        <div>
          <p className="font-headline-sm text-headline-sm break-words text-on-surface">{balance.siteName}</p>
          <p className="font-label-md text-label-md break-words text-on-surface-variant">
            {balance.workType} · {other.name}
            {other.company ? ` (${other.company})` : ""}
          </p>
        </div>
        <div>
          <p className="font-label-md text-label-md text-on-surface-variant">
            {owed > 0 ? text.stillToPay : owed < 0 ? text.paidTooMuch : text.nothingLeft}
          </p>
          <p
            className={`font-stat-callout text-stat-callout tabular-nums ${owed > 0 ? "text-error" : "text-primary"}`}
          >
            {formatRupees(Math.abs(owed))}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-space-lg gap-y-space-md px-space-lg py-space-md sm:grid-cols-4">
        <Figure label={text.dayRate} value={formatRupees(balance.dailyRate)} />
        <Figure label={text.daysWritten} value={formatDays(balance.daysWorked)} />
        <Figure label={text.earned} value={formatRupees(balance.earned)} />
        <Figure label={text.paid} value={formatRupees(balance.paid)} />
      </dl>

      {(hasUnchecked || hasDisputed) && (
        <div className="flex flex-col gap-space-sm border-t border-outline-variant px-space-lg py-space-md">
          {/* The heading must describe all three boxes, not only the first one.
            * Each box is one of the three answers a worker can give about a
            * record: yes, nothing yet, or no. So the heading names the question
            * being answered, and the three numbers always add up to the "Days
            * written down" figure above. */}
          <p className="font-label-md text-label-md text-on-surface-variant">{text.saidAbout}</p>

          <div className="grid grid-cols-3 gap-space-sm">
            <Split label={text.saidYes} value={days(balance.daysConfirmed)} tone="text-primary" />
            <Split label={text.noAnswer} value={days(balance.daysWaiting)} tone="text-on-surface" />
            <Split label={text.saidNo} value={days(balance.daysDisputed)} tone="text-error" />
          </div>

          {/* A negative figure here is not an error and is not rare: it happens
            * whenever money already paid covers more than the agreed days. Left
            * as "-₹1,125" it reads as a debt owed the wrong way round, so the
            * two directions are worded separately. */}
          {confirmedOwed !== owed && (
            <p className="font-label-md text-label-md text-on-surface-variant">
              {confirmedOwed > 0
                ? text.confirmedOwed(formatRupees(confirmedOwed))
                : confirmedOwed < 0
                  ? text.confirmedOverpaid(formatRupees(-confirmedOwed))
                  : text.confirmedNothing}
            </p>
          )}

          {hasDisputed && <Note tone="info">{text.disputed}</Note>}
        </div>
      )}

      {balance.paidDisputed > 0 && (
        <div className="border-t border-outline-variant px-space-lg py-space-md">
          <p className="font-label-md text-label-md text-error">{text.paidDisputed(formatRupees(balance.paidDisputed))}</p>
        </div>
      )}

      {footer && <div className="border-t border-outline-variant px-space-lg py-space-md">{footer}</div>}
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-label-sm text-label-sm text-on-surface-variant">{label}</dt>
      <dd className="font-body-lg-bold text-body-lg-bold tabular-nums whitespace-nowrap text-on-surface">{value}</dd>
    </div>
  );
}

function Split({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="flex min-w-0 flex-col justify-between gap-space-xs rounded-lg bg-surface-container-low p-space-sm">
      <p className="font-label-sm text-label-sm break-words text-on-surface-variant">{label}</p>
      <p className={`font-body-lg-bold text-body-lg-bold tabular-nums whitespace-nowrap ${tone}`}>{value}</p>
    </div>
  );
}
