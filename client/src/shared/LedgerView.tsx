import { useEffect, useState } from "react";
import { api } from "./api";
import type { LedgerResponse, RecordType, VerificationResult } from "./types";
import VerifyPanel from "./components/VerifyPanel";
import {
  Card,
  EmptyState,
  ErrorNote,
  RecordTypeBadge,
  formatDate,
  shortCode,
} from "./components/ui";

const FILTERS: { id: RecordType; label: string }[] = [
  { id: "OFFER", label: "Work offered" },
  { id: "ACCEPT", label: "Said yes" },
  { id: "WORK", label: "Work done" },
  { id: "PAYMENT", label: "Money paid" },
  { id: "CONFIRM", label: "Agreed" },
  { id: "DISPUTE", label: "Said wrong" },
  { id: "EMPLOYER_NOTE", label: "Employer answered" },
];

/**
 * The full record list.
 *
 * Visible to every role on purpose: a record only works as proof if the worker it
 * protects can look at it.
 *
 * The two code columns are what make the linking visible — each record's own code
 * is the next record's "follows on from" value. That is the mechanism in one
 * glance, without needing the word "chain" anywhere on the page.
 */
export default function LedgerView() {
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [error, setError] = useState("");
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [filter, setFilter] = useState<RecordType | "ALL">("ALL");

  useEffect(() => {
    api
      .ledger()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load the records. Please try again."));
  }, []);

  /** Records flagged by the most recent check. */
  const flagged = new Set(verification?.failures.map((f) => f.chainIndex) ?? []);

  const all = data?.entries ?? [];
  const entries = all.filter((e) => filter === "ALL" || e.recordType === filter);
  const count = (t: RecordType) => all.filter((e) => e.recordType === t).length;

  return (
    <div className="space-y-5">
      <VerifyPanel
        onVerified={(r) => {
          setVerification(r);
          // Reload so the table shows current values, including anything changed
          // behind the application's back.
          void api.ledger().then(setData);
        }}
      />

      {error && <ErrorNote message={error} />}

      <Card
        title="All records"
        description="Every job offered, every yes, every day of work, every payment and every answer, in the order they happened. Each line carries a code, and that code also covers the line above it."
        actions={
          <div className="flex flex-wrap rounded-md ring-1 ring-inset ring-slate-300">
            {[{ id: "ALL" as const, label: `All ${all.length}` }, ...FILTERS.map((f) => ({
              id: f.id,
              label: `${f.label} ${count(f.id)}`,
            }))].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`px-2.5 py-1.5 text-xs font-medium transition first:rounded-l-md last:rounded-r-md ${
                  filter === f.id
                    ? "bg-slate-900 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        }
      >
        {!data ? (
          <EmptyState>Loading…</EmptyState>
        ) : entries.length === 0 ? (
          <EmptyState>
            {filter === "ALL"
              ? "Nothing written down yet. A contractor has to offer work first."
              : "Nothing of that kind yet."}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-5 py-2.5 font-medium">No.</th>
                  <th className="px-3 py-2.5 font-medium">What kind</th>
                  <th className="px-3 py-2.5 font-medium">What was written down</th>
                  <th className="px-3 py-2.5 font-medium">Day</th>
                  <th className="px-3 py-2.5 font-medium">Code of the line above</th>
                  <th className="px-5 py-2.5 font-medium">Its own code</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map((e) => {
                  const bad = flagged.has(e.chainIndex);
                  return (
                    <tr key={e.id} className={bad ? "bg-rose-50" : undefined}>
                      <td className="px-5 py-2.5">
                        <span
                          className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums ${
                            bad ? "bg-rose-200 text-rose-900" : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {e.chainIndex}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <RecordTypeBadge type={e.recordType} />
                      </td>
                      <td className="px-3 py-2.5">
                        <p className={bad ? "font-medium text-rose-800" : "text-slate-800"}>
                          {e.summary}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 text-xs whitespace-nowrap text-slate-500">
                        {formatDate(e.createdAt)}
                      </td>
                      <td className="px-3 py-2.5">
                        <code title={e.previousHash} className="text-xs text-slate-400">
                          {shortCode(e.previousHash, 8)}
                        </code>
                      </td>
                      <td className="px-5 py-2.5">
                        <code
                          title={e.currentHash}
                          className={`text-xs ${
                            bad ? "font-semibold text-rose-700" : "text-slate-600"
                          }`}
                        >
                          {shortCode(e.currentHash, 8)}
                        </code>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="space-y-2 border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-500">
              <p>
                Look at the last two columns together. Each line's own code becomes the next line's
                "code of the line above". That is what joins them all in order. If anyone changes one
                line, the codes below it stop matching.
              </p>
              <p>
                When a job is offered and the worker says yes, those are two separate lines, and the
                second one writes the daily pay again. We did that on purpose. If someone lowers the
                daily pay later, both lines stop matching, so the contractor cannot say the worker
                agreed to the lower pay.
              </p>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
