import { useState } from "react";
import { api } from "../api";
import type { VerificationResult } from "../types";
import { Button, RecordTypeBadge } from "./ui";

/**
 * The integrity check and its result.
 *
 * Green when every record still matches what was
 * originally entered; red when something was changed, naming the record, the
 * field, the original value and the current one.
 *
 * The wording avoids "hash", "seal" and "chain" on purpose. A labour officer,
 * a contractor and a worker all need to read this panel, and none of them
 * needs the cryptographic vocabulary to understand what it is telling them. The
 * technical terms live in the code and the README.
 *
 * The check covers the whole chain, but the details come only for records the
 * reader may see (ADR-0013). A problem in someone else's records is reported
 * as a count, so the panel never says "nothing has been changed" while any
 * record anywhere is broken.
 */
export default function VerifyPanel({
  onVerified,
}: {
  onVerified?: (result: VerificationResult) => void;
}) {
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true);
    setError("");
    try {
      const r = await api.verify();
      setResult(r);
      onVerified?.(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The check could not run. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Has anyone changed anything?</h2>
          <p className="mt-0.5 max-w-2xl text-xs text-slate-500">
            Checks that no number has changed since it was written down.
          </p>
        </div>
        <Button onClick={run} disabled={busy}>
          {busy ? "Checking…" : "Check all records"}
        </Button>
      </div>

      {error && (
        <div className="border-t border-slate-200 px-5 py-3">
          <p className="text-sm text-rose-700">{error}</p>
        </div>
      )}

      {result && (
        <div className="border-t border-slate-200 p-5">
          {result.valid ? (
            <div className="rounded-md bg-emerald-50 p-4 ring-1 ring-inset ring-emerald-200">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="grid size-5 place-items-center rounded-full bg-emerald-600 text-xs font-bold text-white"
                >
                  ✓
                </span>
                <p className="text-sm font-semibold text-emerald-900">
                  Nothing has been changed. All {result.entriesChecked} lines are the same.
                </p>
              </div>
              <p className="mt-2 text-xs text-emerald-700">
                We checked at {new Date(result.checkedAt).toLocaleTimeString("en-IN")}
              </p>
            </div>
          ) : result.failures.length === 0 ? (
            // Every problem is in records this reader may not see.
            <div className="rounded-md bg-amber-50 p-4 ring-1 ring-inset ring-amber-200">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="grid size-5 place-items-center rounded-full bg-amber-600 text-xs font-bold text-white"
                >
                  !
                </span>
                <p className="text-sm font-semibold text-amber-900">
                  Your own records are unchanged.
                </p>
              </div>
              <p className="mt-1.5 text-sm text-amber-800">
                We found {result.hiddenFailures} {result.hiddenFailures === 1 ? "problem" : "problems"}{" "}
                in records that are not yours, so we cannot show them to you. The labour office can
                see them.
              </p>
              <p className="mt-2 text-xs text-amber-700">
                We checked at {new Date(result.checkedAt).toLocaleTimeString("en-IN")}
              </p>
            </div>
          ) : (
            <div className="rounded-md bg-rose-50 p-4 ring-1 ring-inset ring-rose-200">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="grid size-5 place-items-center rounded-full bg-rose-600 text-xs font-bold text-white"
                >
                  !
                </span>
                <p className="text-sm font-semibold text-rose-900">
                  Someone changed {result.failures.length} of your line
                  {result.failures.length === 1 ? "" : "s"}
                </p>
              </div>
              {result.hiddenFailures > 0 && (
                <p className="mt-1.5 text-sm text-rose-800">
                  There {result.hiddenFailures === 1 ? "is" : "are"} also {result.hiddenFailures}{" "}
                  {result.hiddenFailures === 1 ? "problem" : "problems"} in records that are not
                  yours. The labour office can see them.
                </p>
              )}

              <ul className="mt-3 space-y-3">
                {result.failures.map((f, i) => (
                  <li
                    key={`${f.entryId}-${f.problem}-${i}`}
                    className="rounded-md bg-white p-3 ring-1 ring-inset ring-rose-200"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <RecordTypeBadge type={f.recordType} />
                    </div>

                    <p className="mt-1.5 text-sm text-slate-700">{f.summary}</p>

                    {/* What actually changed, in plain language. This table is
                        the point of the whole panel. */}
                    {f.changedFields && f.changedFields.length > 0 && (
                      <table className="mt-2 w-full text-left text-xs">
                        <thead className="text-slate-500">
                          <tr>
                            <th className="pr-3 pb-1 font-medium">What</th>
                            <th className="pr-3 pb-1 font-medium">First written as</th>
                            <th className="pb-1 font-medium">It now says</th>
                          </tr>
                        </thead>
                        <tbody>
                          {f.changedFields.map((c) => (
                            <tr key={c.field} className="border-t border-slate-100">
                              <td className="py-1 pr-3 text-slate-700">{c.field}</td>
                              <td className="tnum py-1 pr-3 font-medium text-emerald-700">
                                {c.original}
                              </td>
                              <td className="tnum py-1 font-medium text-rose-700">{c.current}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {(!f.changedFields || f.changedFields.length === 0) && (
                      <p className="mt-1.5 text-sm text-slate-600">{f.detail}</p>
                    )}

                    {/* The raw codes stay available, but folded away, for
                        anyone who needs to check them by hand. */}
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700">
                        Show the security codes
                      </summary>
                      <dl className="mt-1.5 space-y-1 text-xs">
                        <div className="flex gap-2">
                          <dt className="w-40 shrink-0 text-slate-500">The code it should have</dt>
                          <dd className="tnum break-all font-mono text-emerald-700">
                            {f.expected}
                          </dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-40 shrink-0 text-slate-500">The code saved with it</dt>
                          <dd className="tnum break-all font-mono text-rose-700">{f.found}</dd>
                        </div>
                      </dl>
                    </details>
                  </li>
                ))}
              </ul>

              <p className="mt-3 text-xs text-rose-700">
                We checked at {new Date(result.checkedAt).toLocaleTimeString("en-IN")}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
