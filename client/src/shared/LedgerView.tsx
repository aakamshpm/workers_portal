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
/**
 * A summary with each ISO date (2026-07-06) held on one line. The browser may
 * break a line at a hyphen, and "2026-" at the end of one line with "07-06"
 * on the next reads as two numbers. The words around the dates still wrap.
 */
function Summary({ text }: { text: string }) {
  const parts = text.split(/(\d{4}-\d{2}-\d{2})/);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="whitespace-nowrap">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

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
    <div className="flex flex-col gap-space-lg">
      <VerifyPanel
        onVerified={(r) => {
          setVerification(r);
          // Reload so the table shows current values, including anything changed
          // behind the application's back.
          void api.ledger().then(setData);
        }}
      />

      {error && <ErrorNote message={error} />}

      <Card title={t("recordsTitle")} description={t("recordsDescription")}>
        {/* The filters scroll inside their own row, so seven of them never
            make the page wider than the phone. */}
        <div
          role="group"
          aria-label={t("show")}
          className="flex gap-space-sm overflow-x-auto border-b border-outline-variant px-space-lg py-space-md"
        >
          {[
            { id: "ALL" as const, label: `${t("filterAll")} ${all.length}` },
            ...FILTERS.map((f) => ({ id: f.id, label: `${t(f.label)} ${count(f.id)}` })),
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`min-h-[var(--size-touch)] shrink-0 rounded-full px-space-lg whitespace-nowrap font-label-md text-label-md transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                filter === f.id
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container-high text-on-surface hover:bg-surface-container-highest"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {!data ? (
          error ? null : <EmptyState>{t("loading")}</EmptyState>
        ) : entries.length === 0 ? (
          <EmptyState>{filter === "ALL" ? t("nothingYet") : t("nothingOfKind")}</EmptyState>
        ) : (
          <>
            {/* A phone: one card per record (design W7). A table of three
                columns at 320px gave the summary 80px and scrolled sideways. */}
            <ul aria-label={t("recordsTitle")} className="divide-y divide-outline-variant sm:hidden">
              {entries.map((e) => {
                const bad = flagged.has(e.chainIndex);
                return (
                  <li key={e.id} className={`flex flex-col gap-space-xs px-space-lg py-space-md ${bad ? "bg-error-container" : ""}`}>
                    <div className="flex items-center justify-between gap-space-sm">
                      <RecordTypeBadge type={e.recordType} />
                      <span className="font-label-sm text-label-sm whitespace-nowrap text-on-surface-variant">
                        {formatDate(e.createdAt)}
                      </span>
                    </div>
                    <p className={`font-body-lg text-body-lg break-words ${bad ? "text-on-error-container" : "text-on-surface"}`}>
                      <Summary text={e.summary} />
                    </p>
                  </li>
                );
              })}
            </ul>

            {/* A wide screen, which is the officer's website. */}
            <table className="hidden w-full text-left sm:table">
              <thead className="border-b border-outline-variant bg-surface-container-low font-label-md text-label-md text-on-surface-variant">
                <tr>
                  <th className="px-space-lg py-space-sm font-medium">{t("colKind")}</th>
                  <th className="px-space-md py-space-sm font-medium">{t("colWhat")}</th>
                  <th className="px-space-lg py-space-sm font-medium">{t("colDay")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {entries.map((e) => {
                  const bad = flagged.has(e.chainIndex);
                  return (
                    <tr key={e.id} className={bad ? "bg-error-container" : undefined}>
                      <td className="px-space-lg py-space-sm">
                        <RecordTypeBadge type={e.recordType} />
                      </td>
                      <td className="px-space-md py-space-sm">
                        <p className={`font-body-lg text-body-lg ${bad ? "text-on-error-container" : "text-on-surface"}`}>
                          <Summary text={e.summary} />
                        </p>
                      </td>
                      <td className="px-space-lg py-space-sm font-label-sm text-label-sm whitespace-nowrap text-on-surface-variant">
                        {formatDate(e.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </Card>
    </div>
  );
}
