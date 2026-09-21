import type { ContractBalance } from "../types";
import { Card, formatDays, formatRupees, InfoNote } from "./ui";

/**
 * One accepted contract, with the money worked out.
 *
 * The layout deliberately separates two different things: what the contractor
 * recorded, and what the worker has agreed to. A single "you are owed X" figure
 * would read as a fact when part of it may be one person's unchecked claim.
 */
export default function BalanceCard({
  balance,
  viewer,
  footer,
}: {
  balance: ContractBalance;
  viewer: "WORKER" | "CONTRACTOR" | "AUTHORITY";
  footer?: React.ReactNode;
}) {
  const owed = balance.balance;
  const other = viewer === "WORKER" ? balance.contractor : balance.worker;

  const hasUnchecked = balance.awaitingConfirmation > 0;
  const hasDisputed = balance.disputedRecords > 0;

  // Only the worker answers these records, so on his own card the labels address
  // him directly. Anyone else is reading about him.
  const isWorker = viewer === "WORKER";
  const subject = isWorker ? "you" : "the worker";
  const Subject = isWorker ? "You" : "Worker";

  // What the figure is worth if only the worker-agreed records are counted. When
  // everything is confirmed this equals `owed`, and the second line is hidden.
  const confirmedOwed = balance.earnedConfirmed - balance.paidConfirmed;

  return (
    <Card>
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">{balance.siteName}</p>
            <p className="text-xs text-slate-500">
              {balance.workType} · {other.name}
              {other.company ? ` (${other.company})` : ""}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">
              {owed > 0 ? "Still to be paid" : owed < 0 ? "Paid too much" : "Nothing left to pay"}
            </p>
            <p
              className={`text-xl font-semibold tabular-nums ${
                owed > 0 ? "text-rose-700" : "text-emerald-700"
              }`}
            >
              {formatRupees(Math.abs(owed))}
            </p>
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 py-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-slate-500">Pay for one day</dt>
          <dd className="font-medium tabular-nums text-slate-900">
            {formatRupees(balance.dailyRate)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Days written down</dt>
          <dd className="font-medium tabular-nums text-slate-900">
            {formatDays(balance.daysWorked)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Earned in total</dt>
          <dd className="font-medium tabular-nums text-slate-900">
            {formatRupees(balance.earned)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Already paid</dt>
          <dd className="font-medium tabular-nums text-slate-900">{formatRupees(balance.paid)}</dd>
        </div>
      </dl>

      {(hasUnchecked || hasDisputed) && (
        <div className="space-y-2 border-t border-slate-200 px-5 py-4">
          {/* The heading must describe all three boxes, not only the first one.
            * Each box is one of the three answers a worker can give about a
            * record: yes, nothing yet, or no. So the heading names the question
            * being answered, and the three numbers always add up to the "Days
            * written down" figure above. */}
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            What {subject} said about these {formatDays(balance.daysWorked)} days
          </p>

          <div className="grid gap-2 sm:grid-cols-3">
            <Split
              label={`${Subject} said yes`}
              days={balance.daysConfirmed}
              tone="text-emerald-700"
            />
            <Split label="No answer yet" days={balance.daysWaiting} tone="text-amber-700" />
            <Split
              label={`${Subject} said no`}
              days={balance.daysDisputed}
              tone="text-rose-700"
            />
          </div>

          {/* A negative figure here is not an error and is not rare: it happens
            * whenever money already paid covers more than the agreed days. Left
            * as "-₹1,125" it reads as a debt owed the wrong way round, so the
            * two directions are worded separately. */}
          {confirmedOwed !== owed && (
            <p className="text-xs text-slate-600">
              {confirmedOwed > 0 ? (
                <>
                  Counting only the days {subject} said yes to, {subject === "you" ? "you are" : "he is"}{" "}
                  owed{" "}
                  <span className="font-semibold tabular-nums">
                    {formatRupees(confirmedOwed)}
                  </span>
                  .
                </>
              ) : confirmedOwed < 0 ? (
                <>
                  Counting only the days {subject} said yes to,{" "}
                  {isWorker ? "you have already been paid" : "he has already been paid"}{" "}
                  <span className="font-semibold tabular-nums">
                    {formatRupees(-confirmedOwed)}
                  </span>{" "}
                  more than those days come to.
                </>
              ) : (
                <>Counting only the days {subject} said yes to, nothing is left to pay.</>
              )}
            </p>
          )}

          {hasDisputed && (
            <InfoNote>
              {isWorker
                ? `You said no to ${balance.disputedRecords} record${balance.disputedRecords === 1 ? "" : "s"} here. The labour office can see this even if you never make a complaint.`
                : `The worker said no to ${balance.disputedRecords} record${balance.disputedRecords === 1 ? "" : "s"} here. The labour office can see this even if he never makes a complaint.`}
            </InfoNote>
          )}
        </div>
      )}

      {balance.paidDisputed > 0 && (
        <div className="border-t border-slate-200 px-5 py-3">
          <p className="text-xs text-rose-700">
            {isWorker
              ? `You say you never got ${formatRupees(balance.paidDisputed)} of the money written down here, so that part is not settled.`
              : `The worker says he never got ${formatRupees(balance.paidDisputed)} of the money written down here, so that part is not settled.`}
          </p>
        </div>
      )}

      {footer && <div className="border-t border-slate-200 px-5 py-3">{footer}</div>}
    </Card>
  );
}

function Split({ label, days, tone }: { label: string; days: number; tone: string }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-sm font-semibold tabular-nums ${tone}`}>
        {formatDays(days)} day{days === 1 ? "" : "s"}
      </p>
    </div>
  );
}
