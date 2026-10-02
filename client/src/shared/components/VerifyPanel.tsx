import { useId, useState } from "react";
import { api } from "../api";
import type { VerificationResult } from "../types";
import { useT } from "../i18n";
import Icon from "./Icon";
import { Button, Note, RecordTypeBadge } from "./ui";

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
  const { t } = useT();
  const headingId = useId();

  async function run() {
    setBusy(true);
    setError("");
    try {
      const r = await api.verify();
      setResult(r);
      onVerified?.(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("verifyFailed"));
    } finally {
      setBusy(false);
    }
  }

  const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-space-md rounded-xl bg-surface-container-lowest p-space-lg shadow-sm"
    >
      <div className="flex items-start gap-space-md">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container">
          <Icon name="verified_user" size={22} />
        </span>
        <div className="flex min-w-0 flex-col gap-space-xs">
          <h2 id={headingId} className="font-headline-sm text-headline-sm text-on-surface">
            {t("verifyTitle")}
          </h2>
          <p className="font-label-md text-label-md text-on-surface-variant">{t("verifyDescription")}</p>
        </div>
      </div>

      <Button size="page" icon="search" busy={busy} onClick={run}>
        {busy ? t("verifyChecking") : t("verifyButton")}
      </Button>

      {error && <Note tone="error">{error}</Note>}

      {result &&
        (result.valid ? (
          <Note tone="success">
            {t("verifyAllSame", { count: result.entriesChecked })} {t("verifyCheckedAt", { time: time(result.checkedAt) })}
          </Note>
        ) : result.failures.length === 0 ? (
          // Every problem is in records this reader may not see.
          <Note tone="warning">
            <strong className="font-semibold">{t("verifyYoursSame")}</strong>{" "}
            {t("verifyHiddenOnly", { count: result.hiddenFailures })} {t("verifyCheckedAt", { time: time(result.checkedAt) })}
          </Note>
        ) : (
          <div role="alert" className="flex flex-col gap-space-md rounded-xl bg-error-container p-space-lg text-on-error-container">
            <p className="flex items-center gap-space-sm font-body-lg-bold text-body-lg-bold">
              <Icon name="warning" filled className="shrink-0" />
              {t("verifyChanged", { count: result.failures.length })}
            </p>
            {result.hiddenFailures > 0 && (
              <p className="font-body-lg text-body-lg">{t("verifyAlsoHidden", { count: result.hiddenFailures })}</p>
            )}

            <ul className="flex flex-col gap-space-sm">
              {result.failures.map((f, i) => (
                <li
                  key={`${f.entryId}-${f.problem}-${i}`}
                  className="flex flex-col gap-space-sm rounded-xl bg-surface-container-lowest p-space-md text-on-surface"
                >
                  <div>
                    <RecordTypeBadge type={f.recordType} />
                  </div>
                  <p className="font-body-lg text-body-lg break-words">{f.summary}</p>

                  {/* What actually changed, one line per field. This list is
                      the point of the whole panel. */}
                  {f.changedFields && f.changedFields.length > 0 ? (
                    <dl className="flex flex-col gap-space-sm">
                      {f.changedFields.map((c) => (
                        <div key={c.field} className="rounded-lg bg-surface-container-low p-space-sm">
                          <dt className="font-label-md text-label-md text-on-surface-variant">{c.field}</dt>
                          <dd className="font-body-lg text-body-lg break-words">
                            {t("verifyFirstWritten")}: <span className="font-semibold tabular-nums">{c.original}</span>
                          </dd>
                          <dd className="font-body-lg text-body-lg break-words text-error">
                            {t("verifyNowSays")}: <span className="font-semibold tabular-nums">{c.current}</span>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="font-body-lg text-body-lg text-on-surface-variant">{f.detail}</p>
                  )}

                  {/* The raw codes stay available, but folded away, for
                      anyone who needs to check them by hand. */}
                  <details>
                    <summary className="flex min-h-[var(--size-touch)] cursor-pointer items-center font-label-md text-label-md text-primary">
                      {t("verifyShowCodes")}
                    </summary>
                    <dl className="flex flex-col gap-space-xs font-label-sm text-label-sm">
                      <dt className="text-on-surface-variant">{t("verifyCodeExpected")}</dt>
                      <dd className="font-mono break-all">{f.expected}</dd>
                      <dt className="text-on-surface-variant">{t("verifyCodeFound")}</dt>
                      <dd className="font-mono break-all text-error">{f.found}</dd>
                    </dl>
                  </details>
                </li>
              ))}
            </ul>

            <p className="font-label-sm text-label-sm">{t("verifyCheckedAt", { time: time(result.checkedAt) })}</p>
          </div>
        ))}
    </section>
  );
}
