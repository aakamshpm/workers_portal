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
        <div className="px-space-lg pt-space-md">
          <InfoNote>
            {unanswered === 1
              ? "You have not answered 1 of these."
              : `You have not answered ${unanswered} of these.`}
          </InfoNote>
        </div>
      )}

      <ul className="divide-y divide-outline-variant">
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
    <li className="px-space-lg py-space-md">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-body-lg-bold text-body-lg-bold text-on-surface">
            {isWorker ? d.contractor.name : d.worker.name} ·{" "}
            {d.kind === "WORK" ? "Days of work" : "Payment"}
          </p>
          <p className="font-label-md text-label-md text-on-surface-variant">
            {d.period} · {d.siteName}
            {d.at ? ` · ${isWorker ? "you said this on" : "he said this on"} ${formatDate(d.at)}` : ""}
            {d.via ? `, by ${d.via === "SMS" ? "text message" : "the app"}` : ""}
          </p>
        </div>
        {d.gapValue !== null && (
          <div className="text-right">
            <p className="font-label-md text-label-md text-on-surface-variant">Money in question</p>
            <p className="font-body-lg-bold text-body-lg-bold tabular-nums text-error">
              {formatRupees(d.gapValue)}
            </p>
          </div>
        )}
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg bg-surface-container-low px-space-md py-space-sm">
          <p className="font-label-md text-label-md text-on-surface-variant">{isWorker ? "He wrote down" : "You recorded"}</p>
          <p className="font-body-lg-bold text-body-lg-bold text-on-surface">{d.contractorSays}</p>
        </div>
        <div className="rounded-lg bg-error-container px-space-md py-space-sm">
          <p className="font-label-md text-label-md text-on-error-container">{isWorker ? "You say" : "He says"}</p>
          <p className="font-body-lg-bold text-body-lg-bold text-on-error-container">{d.workerSays}</p>
        </div>
      </div>

      {d.workerNote && (
        <p className="mt-2 font-label-md text-label-md text-on-surface">
          {isWorker ? "You added: " : "He added: "}
          {d.workerNote}
        </p>
      )}

      {/* The contractor's account. The worker must see this too: it is the other
        * half of his own disagreement, and hiding it would leave him arguing
        * against something he cannot read. */}
      {d.employerStatement ? (
        <div className="mt-3 rounded-lg bg-surface-container px-space-md py-space-sm">
          <p className="font-label-md text-label-md text-on-surface-variant">
            {isWorker
              ? `What ${d.contractor.name} says happened, written on ${formatDate(d.employerStatement.at)}`
              : `Your answer, written on ${formatDate(d.employerStatement.at)} and now on the file`}
          </p>
          <p className="mt-0.5 font-body-lg text-body-lg text-on-surface">{d.employerStatement.note}</p>
        </div>
      ) : isWorker ? (
        <p className="mt-2 font-label-md text-label-md text-on-surface-variant">
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
            <Button disabled={busy || note.trim().length < 10} onClick={() => void submit()}>
              {busy ? "Saving…" : "Add my answer to the file"}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Write my answer
          </Button>
        </div>
      )}

      {/* What the labour office did. Both sides see this, because a disagreement
        * that has been looked at and one that nobody has read are different
        * situations, and neither party can tell them apart otherwise. */}
      {d.review ? (
        <div className="mt-3 rounded-lg bg-surface-container-high px-space-md py-space-sm">
          <p className="font-label-md text-label-md text-on-surface">
            {REVIEW_REASON[d.review.reason] ?? d.review.reason} · {d.review.officer.name} ·{" "}
            {formatDate(d.review.at)}
          </p>
          <p className="mt-0.5 font-body-lg text-body-lg text-on-surface">{d.review.note}</p>
          {isWorker && (
            <p className="mt-1 font-label-md text-label-md text-on-surface-variant">If this is still wrong, ask for help.</p>
          )}
        </div>
      ) : (
        <p className="mt-3 font-label-md text-label-md text-on-surface-variant">
          The labour office has not looked at this yet.
        </p>
      )}
    </li>
  );
}
