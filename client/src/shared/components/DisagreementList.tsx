import { useState } from "react";
import { api } from "../api";
import type { Disagreement } from "../types";
import { Button, Card, Field, formatDate, formatRupees, InfoNote, inputClass } from "./ui";

/** Plain words for each reason an officer took a disagreement off her list. */
const REVIEW_REASON: Record<string, string> = {
  SETTLED_OUTSIDE: "The labour office says you two settled it",
  DECIDED: "The labour office already decided this",
  NO_ACTION: "The labour office looked and is taking no action",
  UNPROVABLE: "The labour office says nothing can prove it",
};

/**
 * Records the worker rejected, shown to one of the two people involved.
 *
 * One component for both roles, fed by one route, so the worker and the
 * contractor are always shown the same facts about the same disagreement. Only
 * the wording changes with `viewer`.
 *
 * The contractor can add his account here, once. The worker cannot answer back:
 * his rejection is already his statement, and the record he rejected is the
 * contractor's. Neither of them can change a figure.
 */
export default function DisagreementList({
  items,
  viewer,
  onDone,
  onError,
}: {
  items: Disagreement[];
  viewer: "WORKER" | "CONTRACTOR";
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const isWorker = viewer === "WORKER";
  const unanswered = items.filter((d) => d.employerStatement === null).length;

  return (
    <Card
      title={
        isWorker
          ? `Things you said are wrong (${items.length})`
          : `Your worker says these are wrong (${items.length})`
      }
      description={
        isWorker
          ? "The labour office can see these."
          : "Add your side. The labour officer will read it."
      }
    >
      {!isWorker && unanswered > 0 && (
        <div className="px-5 pt-4">
          <InfoNote>
            {unanswered === 1
              ? "You have not answered 1 of these."
              : `You have not answered ${unanswered} of these.`}
          </InfoNote>
        </div>
      )}

      <ul className="divide-y divide-slate-200">
        {items.map((d) => (
          <Row
            key={`${d.kind}-${d.id}`}
            d={d}
            isWorker={isWorker}
            onDone={onDone}
            onError={onError}
          />
        ))}
      </ul>
    </Card>
  );
}

function Row({
  d,
  isWorker,
  onDone,
  onError,
}: {
  d: Disagreement;
  isWorker: boolean;
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const res = await api.writeStatement({ kind: d.kind, id: d.id, note });
      onDone(res.message);
      setOpen(false);
      setNote("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not save your answer. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900">
            {isWorker ? d.contractor.name : d.worker.name} ·{" "}
            {d.kind === "WORK" ? "Days of work" : "Payment"}
          </p>
          <p className="text-xs text-slate-500">
            {d.period} · {d.siteName}
            {d.at ? ` · ${isWorker ? "you said this on" : "he said this on"} ${formatDate(d.at)}` : ""}
            {d.via ? `, by ${d.via === "SMS" ? "text message" : "the app"}` : ""}
          </p>
        </div>
        {d.gapValue !== null && (
          <div className="text-right">
            <p className="text-xs text-slate-500">Money in question</p>
            <p className="text-sm font-semibold tabular-nums text-rose-700">
              {formatRupees(d.gapValue)}
            </p>
          </div>
        )}
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div className="rounded-md bg-slate-50 px-3 py-2">
          <p className="text-xs text-slate-500">{isWorker ? "He wrote down" : "You recorded"}</p>
          <p className="text-sm font-medium text-slate-900">{d.contractorSays}</p>
        </div>
        <div className="rounded-md bg-rose-50 px-3 py-2 ring-1 ring-inset ring-rose-200">
          <p className="text-xs text-rose-700">{isWorker ? "You say" : "He says"}</p>
          <p className="text-sm font-medium text-rose-900">{d.workerSays}</p>
        </div>
      </div>

      {d.workerNote && (
        <p className="mt-2 text-xs text-slate-600">
          {isWorker ? "You added: " : "He added: "}
          {d.workerNote}
        </p>
      )}

      {/* The contractor's account. The worker must see this too: it is the other
        * half of his own disagreement, and hiding it would leave him arguing
        * against something he cannot read. */}
      {d.employerStatement ? (
        <div className="mt-3 rounded-md bg-sky-50 px-3 py-2 ring-1 ring-inset ring-sky-200">
          <p className="text-xs text-sky-800">
            {isWorker
              ? `What ${d.contractor.name} says happened, written on ${formatDate(d.employerStatement.at)}`
              : `Your answer, written on ${formatDate(d.employerStatement.at)} and now on the file`}
          </p>
          <p className="mt-0.5 text-sm text-sky-900">{d.employerStatement.note}</p>
        </div>
      ) : isWorker ? (
        <p className="mt-2 text-xs text-slate-500">
          {d.contractor.name} has not written anything about this yet.
        </p>
      ) : open ? (
        <div className="mt-3 space-y-2">
          <Field
            label="What actually happened?"
            hint="You can write this once. The worker will see it."
          >
            <textarea
              className={inputClass}
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What happened?"
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy || note.trim().length < 10} onClick={() => void submit()}>
              {busy ? "Saving…" : "Add my answer to the file"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            Write my answer
          </Button>
        </div>
      )}

      {/* What the labour office did. Both sides see this, because a disagreement
        * that has been looked at and one that nobody has read are different
        * situations, and neither party can tell them apart otherwise. */}
      {d.review ? (
        <div className="mt-3 rounded-md bg-slate-100 px-3 py-2">
          <p className="text-xs font-medium text-slate-700">
            {REVIEW_REASON[d.review.reason] ?? d.review.reason} · {d.review.officer.name} ·{" "}
            {formatDate(d.review.at)}
          </p>
          <p className="mt-0.5 text-sm text-slate-700">{d.review.note}</p>
          {isWorker && (
            <p className="mt-1 text-xs text-slate-500">If this is still wrong, ask for help.</p>
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs text-amber-700">
          The labour office has not looked at this yet.
        </p>
      )}
    </li>
  );
}
