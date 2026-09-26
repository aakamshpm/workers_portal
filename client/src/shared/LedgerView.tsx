import { useEffect, useState } from "react";
import { api } from "./api";
import type { LedgerResponse, RecordType, VerificationResult } from "./types";
import VerifyPanel from "./components/VerifyPanel";
import { useT } from "./i18n";
import type { MessageKey } from "./i18n/en";
import {
  Card,
  EmptyState,
  ErrorNote,
  RecordTypeBadge,
  formatDate,
} from "./components/ui";

// English in the contractor and officer apps, the worker's language in his (ADR-0015).
const FILTERS: { id: RecordType; label: MessageKey }[] = [
  { id: "OFFER", label: "recOffer" },
  { id: "ACCEPT", label: "recAccept" },
  { id: "WORK", label: "recWork" },
  { id: "PAYMENT", label: "recPayment" },
  { id: "CONFIRM", label: "recConfirm" },
  { id: "DISPUTE", label: "recDispute" },
  { id: "EMPLOYER_NOTE", label: "recEmployerNote" },
];

/**
 * The records the reader may see (ADR-0013): a worker his own contracts, a
 * contractor his own contracts, the labour officer everything. A record only
 * works as proof if the worker it protects can look at it, and it only stays
 * private if nobody else can.
 *
 * The chain's own numbers and codes are not shown: they mean nothing to the
 * reader, and for everyone except the officer the numbers would have gaps
 * where other people's records sit. A changed record is marked in red after
 * "Check all records".
 */
export default function LedgerView() {
  const { t } = useT();
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [error, setError] = useState("");
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [filter, setFilter] = useState<RecordType | "ALL">("ALL");

  useEffect(() => {
    api
      .ledger()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : t("errorLoadRecords")));
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
        title={t("recordsTitle")}
        description={t("recordsDescription")}
        actions={
          <div className="flex flex-wrap rounded-md ring-1 ring-inset ring-slate-300">
            {[{ id: "ALL" as const, label: `${t("filterAll")} ${all.length}` }, ...FILTERS.map((f) => ({
              id: f.id,
              label: `${t(f.label)} ${count(f.id)}`,
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
          <EmptyState>{t("loading")}</EmptyState>
        ) : entries.length === 0 ? (
          <EmptyState>
            {filter === "ALL"
              ? t("nothingYet")
              : t("nothingOfKind")}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-5 py-2.5 font-medium">{t("colKind")}</th>
                  <th className="px-3 py-2.5 font-medium">{t("colWhat")}</th>
                  <th className="px-5 py-2.5 font-medium">{t("colDay")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map((e) => {
                  const bad = flagged.has(e.chainIndex);
                  return (
                    <tr key={e.id} className={bad ? "bg-rose-50" : undefined}>
                      <td className="px-5 py-2.5">
                        <RecordTypeBadge type={e.recordType} />
                      </td>
                      <td className="px-3 py-2.5">
                        <p className={bad ? "font-medium text-rose-800" : "text-slate-800"}>
                          {e.summary}
                        </p>
                      </td>
                      <td className="px-5 py-2.5 text-xs whitespace-nowrap text-slate-500">
                        {formatDate(e.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
