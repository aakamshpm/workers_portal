import { useCallback, useEffect, useState } from "react";
import { api } from "../shared/api";
import type { AuthUser, AwaitingItem, ContractBalance, Disagreement, Offer } from "../shared/types";
import BalanceCard from "../shared/components/BalanceCard";
import DisagreementList from "../shared/components/DisagreementList";
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  formatDate,
  formatDays,
  formatRupees,
  InfoNote,
  inputClass,
  OfferBadge,
  SuccessNote,
} from "../shared/components/ui";

/**
 * What the worker sees.
 *
 * Ordered by what needs an answer, not by what is newest. Job offers first,
 * because terms lock on acceptance. Then records the contractor wrote that the
 * worker has not checked, because an unanswered work record is how an
 * understated week becomes permanent. The money comes last: it is the reason the
 * worker is here, but it is a consequence of the two lists above.
 */
export default function WorkerDashboard({
  user,
  onFileComplaint,
}: {
  user: AuthUser;
  onFileComplaint?: () => void;
}) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [awaiting, setAwaiting] = useState<AwaitingItem[]>([]);
  const [balances, setBalances] = useState<ContractBalance[]>([]);
  const [disagreements, setDisagreements] = useState<Disagreement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [o, a, b, d] = await Promise.all([
        api.offers("PENDING"),
        api.awaiting(),
        api.balances(),
        api.disagreements(),
      ]);
      setOffers(o);
      setAwaiting(a);
      setBalances(b);
      setDisagreements(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your work");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <EmptyState>Please wait…</EmptyState>;

  const totalOwed = balances.reduce((sum, b) => sum + Math.max(0, b.balance), 0);

  return (
    <div className="space-y-5">
      {error && <ErrorNote message={error} />}
      {flash && <SuccessNote>{flash}</SuccessNote>}

      {totalOwed > 0 && (
        <div className="rounded-lg bg-slate-900 px-5 py-4 text-white">
          <p className="text-xs text-slate-300">
            {user.name}, you are still owed this much from {balances.length} job
            {balances.length === 1 ? "" : "s"}
          </p>
          <p className="text-3xl font-semibold tabular-nums">{formatRupees(totalOwed)}</p>
        </div>
      )}

      {offers.length > 0 && (
        <Card
          title="A contractor is offering you work"
          description="Check the daily pay. After you say yes, it cannot be changed."
        >
          <ul className="divide-y divide-slate-200">
            {offers.map((offer) => (
              <OfferRow
                key={offer.id}
                offer={offer}
                onDone={(msg) => {
                  setFlash(msg);
                  void load();
                }}
                onError={setError}
              />
            ))}
          </ul>
        </Card>
      )}

      <Card
        title="Please check these"
        description="Your contractor wrote these down. If a number is wrong, say so now. If you say nothing, it stays the way he wrote it."
      >
        {awaiting.length === 0 ? (
          <EmptyState>Nothing is waiting for your answer.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-200">
            {awaiting.map((item) => (
              <AwaitingRow
                key={`${item.kind}-${item.id}`}
                item={item}
                onDone={(msg) => {
                  setFlash(msg);
                  void load();
                }}
                onError={setError}
              />
            ))}
          </ul>
        )}
      </Card>

      {disagreements.length > 0 && (
        <DisagreementList
          items={disagreements}
          viewer="WORKER"
          onDone={(msg) => {
            setFlash(msg);
            void load();
          }}
          onError={setError}
        />
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Your work</h2>
        {balances.length === 0 ? (
          <Card>
            <EmptyState>
              You have not taken any job yet. When a contractor offers you work, it will show at the
              top of this page and as a message on your phone.
            </EmptyState>
          </Card>
        ) : (
          <div className="space-y-4">
            {balances.map((b) => (
              <BalanceCard
                key={b.offerId}
                balance={b}
                viewer="WORKER"
                footer={
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-slate-500">
                      You said yes on {b.acceptedAt ? formatDate(b.acceptedAt) : "—"}
                      {b.acceptedVia ? `, by ${b.acceptedVia === "SMS" ? "message" : "this app"}` : ""}
                      {b.openComplaints > 0 &&
                        ` · ${b.openComplaints} complaint${b.openComplaints === 1 ? "" : "s"} still open`}
                    </p>
                    {onFileComplaint && b.openComplaints === 0 && (
                      <Button variant="secondary" size="sm" onClick={onFileComplaint}>
                        Ask the labour office for help
                      </Button>
                    )}
                  </div>
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** One pending job offer, with accept and refuse. */
function OfferRow({
  offer,
  onDone,
  onError,
}: {
  offer: Offer;
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState("");

  async function respond(decision: "ACCEPT" | "DECLINE") {
    setBusy(true);
    try {
      await api.respondToOffer(offer.id, decision, reason || undefined);
      onDone(
        decision === "ACCEPT"
          ? `You said yes to ${formatRupees(offer.dailyRate)} a day at ${offer.siteName}. This pay is now fixed and cannot be changed.`
          : "You said no. The contractor has been told.",
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not send your answer");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900">
            {offer.workType} at {offer.siteName}
          </p>
          <p className="text-xs text-slate-500">
            {offer.contractor.name}
            {offer.contractor.company ? ` · ${offer.contractor.company}` : ""} · work starts{" "}
            {formatDate(offer.startDate)} · about {offer.expectedDays} days of work
          </p>
          {offer.extraTerms && (
            <p className="mt-1 text-xs text-slate-600">He also promised: {offer.extraTerms}</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold tabular-nums text-slate-900">
            {formatRupees(offer.dailyRate)}
          </p>
          <p className="text-xs text-slate-500">a day</p>
        </div>
      </div>

      <div className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
        If you work all {offer.expectedDays} days for this pay, you should get{" "}
        <span className="font-semibold tabular-nums text-slate-900">
          {formatRupees(offer.dailyRate * offer.expectedDays)}
        </span>{" "}
        in total.
      </div>

      {!refusing ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="success" size="sm" disabled={busy} onClick={() => void respond("ACCEPT")}>
            {busy ? "Sending…" : "Yes, I will take this work"}
          </Button>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => setRefusing(true)}>
            No, I do not want it
          </Button>
          <OfferBadge status={offer.status} />
          {offer.ref && (
            <span className="text-xs text-slate-400">
              You can also send the message YES {offer.ref} from your phone
            </span>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <Field label="Why are you saying no? (you can leave this empty)">
            <input
              className={inputClass}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <div className="flex gap-2">
            <Button variant="danger" size="sm" disabled={busy} onClick={() => void respond("DECLINE")}>
              {busy ? "Sending…" : "Yes, send my no"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRefusing(false)}>
              Go back
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * One record needing OK or WRONG.
 *
 * Rejecting asks for the worker's own figure. "That is wrong" alone leaves the
 * labour officer with a disagreement and no shape to it; "he wrote 3 days, I
 * worked 6" gives them a specific gap worth a specific amount.
 */
function AwaitingRow({
  item,
  onDone,
  onError,
}: {
  item: AwaitingItem;
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [objecting, setObjecting] = useState(false);
  const [workerValue, setWorkerValue] = useState("");
  const [note, setNote] = useState("");

  const isWork = item.kind === "WORK";

  async function decide(decision: "CONFIRM" | "REJECT") {
    setBusy(true);
    try {
      await api.confirmRecord({
        kind: item.kind,
        id: item.id,
        decision,
        workerValue: workerValue ? Number(workerValue) : undefined,
        note: note || undefined,
      });
      onDone(
        decision === "CONFIRM"
          ? "Thank you. Both of you now agree on this one."
          : "We have written down that you say this is wrong. The labour office can see it.",
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not send your answer");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900">
            {isWork
              ? `He says you worked ${formatDays(item.days ?? 0)} day${item.days === 1 ? "" : "s"}`
              : `He says he gave you ${formatRupees(item.amount ?? 0)}`}
          </p>
          <p className="text-xs text-slate-500">
            {isWork
              ? `${formatDate(item.fromDate!)} to ${formatDate(item.toDate!)}`
              : `${formatDate(item.paidOn!)} · in ${item.method === "CASH" ? "cash" : item.method}`}
            {" · "}
            {item.contractorName}
            {item.company ? ` (${item.company})` : ""} · {item.siteName}
          </p>
          {item.note && <p className="mt-1 text-xs text-slate-600">He wrote: {item.note}</p>}
        </div>
        {isWork && item.worth !== undefined && (
          <div className="text-right">
            <p className="text-xs text-slate-500">That is worth</p>
            <p className="text-sm font-semibold tabular-nums text-slate-900">
              {formatRupees(item.worth)}
            </p>
          </div>
        )}
      </div>

      {!objecting ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="success" size="sm" disabled={busy} onClick={() => void decide("CONFIRM")}>
            {busy ? "Sending…" : isWork ? "Yes, that is correct" : "Yes, I got that money"}
          </Button>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => setObjecting(true)}>
            {isWork ? "No, that is not correct" : "No, I did not get it"}
          </Button>
          {item.ref && (
            <span className="text-xs text-slate-400">
              Or send OK {item.ref} to say yes, or WRONG {item.ref} to say no
            </span>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-2 rounded-md bg-rose-50 p-3 ring-1 ring-inset ring-rose-200">
          <Field
            label={isWork ? "How many days did you really work?" : "How much money did you really get?"}
            hint="Write the right number."
          >
            <input
              className={inputClass}
              type="number"
              step={isWork ? "0.5" : "1"}
              min="0"
              value={workerValue}
              onChange={(e) => setWorkerValue(e.target.value)}
              placeholder={isWork ? "6" : "0"}
            />
          </Field>
          <Field label="Do you want to add anything? (you can leave this empty)">
            <input
              className={inputClass}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <div className="flex gap-2">
            <Button variant="danger" size="sm" disabled={busy} onClick={() => void decide("REJECT")}>
              {busy ? "Sending…" : "Send my answer"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setObjecting(false)}>
              Go back
            </Button>
          </div>
          <InfoNote>The labour office will see both numbers.</InfoNote>
        </div>
      )}
    </li>
  );
}
