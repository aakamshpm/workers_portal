import { Route, Routes, useNavigate } from "react-router-dom";
import { AppShell, FirstTab, useAppSession, type Tab } from "../shared/AppShell";
import LedgerView from "../shared/LedgerView";
import type { AuthUser } from "../shared/types";
import WorkerDashboard from "./WorkerDashboard";
import FindWorkPage from "./FindWorkPage";
import ComplaintPage from "./ComplaintPage";

/**
 * The worker app, at /worker/. ADR-0012.
 *
 * Opens only for a worker. Installable in the PWA step, with a manifest
 * scoped to /worker/. There is no pay screen and no complaint desk here.
 */
const TABS: Tab[] = [
  { path: "work", label: "My work" },
  { path: "find-work", label: "Find work" },
  { path: "help", label: "Ask for help" },
  { path: "records", label: "All records" },
];

export default function WorkerApp() {
  const user = useAppSession("WORKER");
  if (!user) return null;

  return (
    <AppShell user={user} tabs={TABS}>
      <Routes>
        <Route path="/work" element={<Work user={user} />} />
        <Route path="/find-work" element={<FindWorkPage />} />
        <Route path="/help" element={<ComplaintPage user={user} />} />
        <Route path="/records" element={<LedgerView />} />
        <Route path="*" element={<FirstTab tabs={TABS} />} />
      </Routes>
    </AppShell>
  );
}

function Work({ user }: { user: AuthUser }) {
  const navigate = useNavigate();
  return <WorkerDashboard user={user} onFileComplaint={() => navigate("/help")} />;
}
