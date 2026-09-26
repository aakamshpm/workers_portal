import { useCallback } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import { api, storeSession } from "../shared/api";
import { AppShell, FirstTab, useAppSession, type Tab } from "../shared/AppShell";
import LedgerView from "../shared/LedgerView";
import { I18nProvider, useT, type Language } from "../shared/i18n";
import type { AuthUser } from "../shared/types";
import WorkerDashboard from "./WorkerDashboard";
import FindWorkPage from "./FindWorkPage";
import ComplaintPage from "./ComplaintPage";

/**
 * The worker app, at /worker/. ADR-0012.
 *
 * Opens only for a worker. Installable in the PWA step, with a manifest
 * scoped to /worker/. There is no pay screen and no complaint desk here.
 *
 * Text is in the worker's own language (ADR-0015). It starts from
 * User.language, the same language as his SMS. Changing it in the header
 * saves it on the server, so his later SMS change too.
 */
export default function WorkerApp() {
  const user = useAppSession("WORKER");

  const save = useCallback((language: Language) => {
    // The page changes at once. Saving happens behind it, and a failure only
    // means later SMS keep the old language, so it is not shown as an error.
    api
      .setLanguage(language)
      .then(({ token, user: updated }) => storeSession(token, updated))
      .catch(() => {});
  }, []);

  if (!user) return null;

  return (
    <I18nProvider initial={user.language} onChange={save}>
      <WorkerRoutes user={user} />
    </I18nProvider>
  );
}

function WorkerRoutes({ user }: { user: AuthUser }) {
  const { t } = useT();
  const tabs: Tab[] = [
    { path: "work", label: t("tabMyWork") },
    { path: "find-work", label: t("tabFindWork") },
    { path: "help", label: t("tabHelp") },
    { path: "records", label: t("tabRecords") },
  ];

  return (
    <AppShell user={user} tabs={tabs}>
      <Routes>
        <Route path="/work" element={<Work user={user} />} />
        <Route path="/find-work" element={<FindWorkPage />} />
        <Route path="/help" element={<ComplaintPage user={user} />} />
        <Route path="/records" element={<LedgerView />} />
        <Route path="*" element={<FirstTab tabs={tabs} />} />
      </Routes>
    </AppShell>
  );
}

function Work({ user }: { user: AuthUser }) {
  const navigate = useNavigate();
  return <WorkerDashboard user={user} onFileComplaint={() => navigate("/help")} />;
}
