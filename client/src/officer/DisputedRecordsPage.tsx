import { useCallback, useEffect, useState } from "react";
import { api } from "../shared/api";
import type { DisputedRecord } from "../shared/types";
import {
  Button,
  Card,
  EmptyState,
  Field,
  formatDate,
  formatDateTime,
  formatRupees,
  inputClass,
  Note,
  PhoneLink,
} from "../shared/components/ui";

/** Plain words for each reason a disagreement was taken off the list. */
const REVIEW_REASON: Record<string, string> = {
  SETTLED_OUTSIDE: "Settled between the two of them",
  DECIDED: "Already decided on a complaint",
  NO_ACTION: "Looked at, no action taken",
  UNPROVABLE: "Nothing can prove it either way",
};

/**
 * Disputed records (design O3, ADR-0021).
 *
 * A record the worker rejected without writing a complaint. That disagreement
 * is already in the data, and making the officer wait for a formal complaint
 * would waste the signal, so it has a page of its own next to Complaints.
 *
 * "Reviewed" here changes no record and seals nothing (ADR-0007, ADR-0019): it
 * takes the record off the waiting list, with the officer's name and his note on
 * it, so a later officer can see it was looked at. It can be put back.
 */
export default function DisputedRecordsPage() {
  const [waiting, setWaiting] = useState<DisputedRecord[]>([]);
  // Reviewed disagreements are fetched separately, so the working queue stays
  // short while a past decision remains findable.
  const [reviewed, setReviewed] = useState<DisputedRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [w, r] = await Promise.all([api.disputedRecords(), api.disputedRecords(true)]);
      setWaiting(w);
      setReviewed(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the records. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <EmptyState>Please wait…</EmptyState>;

  function done(msg: string) {
    setFlash(msg);
    void load();
  }

  return (
    <div className="flex max-w-5xl flex-col gap-space-lg">
      <header className="flex flex-col gap-space-xs">
        <h1 className="font-headline-lg text-headline-lg text-on-surface">Disputed records</h1>
        <p className="font-body-lg text-body-lg text-on-surface-variant">
          Records a worker rejected without writing a complaint.
        </p>
      </header>

      {error && <Note tone="error">{error}</Note>}
      {flash && <Note tone="success">{flash}</Note>}

      <Card
        title={`Needing your attention (${waiting.length})`}
        description="The worker rejected these records. No complaint was filed."
      >
        {waiting.length === 0 ? (
          <EmptyState>Nothing is waiting for you here.</EmptyState>
        ) : (
          <ul className="divide-y divide-outline-variant">
            {waiting.map((d) => (
              <DisputeRow key={`${d.kind}-${d.id}`} d={d} onDone={done} onError={setError} />
            ))}
          </ul>
        )}
      </Card>

      {/* Kept on the page rather than hidden, because "has my office already
        * dealt with this contractor" is the question this whole feature
        * exists to answer. */}
      {reviewed.length > 0 && (
        <Card
          title={`Already dealt with (${reviewed.length})`}
          description="An officer has reviewed these."
        >
          <ul className="divide-y divide-outline-variant">
            {reviewed.map((d) => (
              <DisputeRow key={`${d.kind}-${d.id}`} d={d} onDone={done} onError={setError} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/**
 * One disputed record.
 *
 * Used for both lists. Which list it is in is decided by `d.review`, so the two
 * lists cannot drift apart in wording or behaviour: an unreviewed record offers
 * the review form, a reviewed one shows the officer's note and a way to put it
 * back.
 */
function DisputeRow({
  d,
  onDone,
  onError,
}: {
  d: DisputedRecord;
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<
    "SETTLED_OUTSIDE" | "DECIDED" | "NO_ACTION" | "UNPROVABLE"
  >("SETTLED_OUTSIDE");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const r = await api.reviewDispute({ kind: d.kind, id: d.id, reason, note });
      onDone(r.message);
      setOpen(false);
      setNote("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not save that. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    setBusy(true);
    try {
      const r = await api.reopenDispute(d.kind, d.id);
      onDone(r.message);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not reopen it. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-space-md px-space-lg py-space-md">
      <div className="flex flex-wrap items-start justify-between gap-space-md">
        <div>
          <p className="font-body-lg-medium text-body-lg-medium text-on-surface">
            {d.worker.name} · {d.siteName}
          </p>
          <p className="font-label-md text-label-md text-on-surface-variant">
            {d.kind === "WORK" ? "Days of work" : "Payment"} {d.period} · {d.contractor.name}
            {d.contractor.company ? ` (${d.contractor.company})` : ""}
          </p>
        </div>
        {d.gapValue !== null && (
          <div className="sm:text-right">
            <p className="font-label-md text-label-md text-on-surface-variant">Amount in dispute</p>
            <p className="font-headline-sm text-headline-sm whitespace-nowrap tabular-nums text-error">
              {formatRupees(Math.abs(d.gapValue))}
            </p>
          </div>
        )}
      </div>

      {/* Shown before the two figures, because if a complaint on this contract
        * was already decided, that changes how the officer should read
        * everything below it. */}
      {d.relatedComplaint && !d.review && (
        <div className="flex flex-col gap-space-xs rounded-xl bg-surface-container-high px-space-md py-space-sm text-on-surface">
          <p className="font-body-lg-medium text-body-lg-medium">
            A complaint on this same contract was already closed
            {d.relatedComplaint.closedAt ? ` on ${formatDate(d.relatedComplaint.closedAt)}` : ""}
            {d.relatedComplaint.outcome ? ` as ${d.relatedComplaint.outcome.toLowerCase()}` : ""}.
          </p>
          {d.relatedComplaint.note && (
            <p className="font-label-md text-label-md">{d.relatedComplaint.note}</p>
          )}
          <p className="font-label-md text-label-md">
            This disagreement may be the same matter. Check before contacting anyone again.
          </p>
        </div>
      )}

      <div className="grid gap-space-md sm:grid-cols-2">
        <div className="rounded-xl bg-surface-container-low px-space-md py-space-sm">
          <p className="font-label-md text-label-md text-on-surface-variant">The contractor recorded</p>
          <p className="font-body-lg-medium text-body-lg-medium text-on-surface">{d.contractorSays}</p>
        </div>
        <div className="rounded-xl bg-error-container px-space-md py-space-sm">
          <p className="font-label-md text-label-md text-on-error-container">The worker states</p>
          <p className="font-body-lg-medium text-body-lg-medium text-on-error-container">{d.workerSays}</p>
        </div>
      </div>

      {d.note && (
        <p className="font-label-md text-label-md text-on-surface-variant">The worker added: {d.note}</p>
      )}

      {d.employerStatement ? (
        <div className="rounded-xl bg-surface-container px-space-md py-space-sm">
          <p className="font-label-md text-label-md text-on-surface-variant">
            The contractor's account, given {formatDate(d.employerStatement.at)}
          </p>
          <p className="font-body-lg text-body-lg text-on-surface">{d.employerStatement.note}</p>
        </div>
      ) : (
        <Note tone="warning">
          The contractor has not given his account of this. That is not the same as agreeing with the
          worker.
        </Note>
      )}

      <p className="font-label-md text-label-md text-on-surface-variant">
        Disputed on {d.at ? formatDateTime(d.at) : "—"}
        {d.via ? `, by ${d.via === "SMS" ? "text message" : "the app"}` : ""} · contact{" "}
        {d.worker.phone && <PhoneLink phone={d.worker.phone} />}
      </p>

      {d.review ? (
        <div className="flex flex-col gap-space-sm rounded-xl bg-surface-container px-space-md py-space-sm">
          <p className="font-body-lg-medium text-body-lg-medium text-on-surface">
            {REVIEW_REASON[d.review.reason] ?? d.review.reason} · {d.review.officer.name} ·{" "}
            {formatDate(d.review.at)}
          </p>
          <p className="font-body-lg text-body-lg text-on-surface">{d.review.note}</p>
          <div>
            <Button variant="ghost" size="dense" disabled={busy} onClick={() => void reopen()}>
              {busy ? "Working…" : "Put back on my list"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-space-md">
          <div>
            <Button
              size="dense"
              variant="secondary"
              expanded={open}
              onClick={() => setOpen(!open)}
            >
              No more action needed
            </Button>
          </div>
          {open && (
            <div className="flex max-w-2xl flex-col gap-space-md">
              <Field label="Why does this need no more attention?">
                <select
                  className={inputClass}
                  value={reason}
                  onChange={(e) => setReason(e.target.value as typeof reason)}
                >
                  <option value="SETTLED_OUTSIDE">The two of them settled it themselves</option>
                  <option value="DECIDED">I already decided this on a complaint</option>
                  <option value="UNPROVABLE">Nothing can prove it either way</option>
                  <option value="NO_ACTION">Looked at it, taking no action</option>
                </select>
              </Field>
              <Field
                label="What did you find?"
                hint="Write it for the officer who opens this next year and remembers nothing about it."
              >
                <textarea
                  className={inputClass}
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Called both on 30 Aug. Contractor paid Rs 2,100 in cash at this office, worker confirms he received it. Nothing further to do."
                />
              </Field>
              <div className="flex flex-wrap gap-space-sm">
                <Button size="dense" disabled={busy || note.trim().length < 10} onClick={() => void save()}>
                  {busy ? "Saving…" : "Take off my list"}
                </Button>
                <Button variant="ghost" size="dense" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
