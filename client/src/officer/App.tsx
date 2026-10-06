import { Route, Routes } from "react-router-dom";
import { AppShell, FirstTab, useAppSession, type Tab } from "../shared/AppShell";
import LedgerView from "../shared/LedgerView";
import AccountsPage from "./AccountsPage";
import ComplaintsPage from "./ComplaintsPage";
import DisputedRecordsPage from "./DisputedRecordsPage";

/**
 * The labour officer website, at /officer/. ADR-0012.
 *
 * Opens only for a labour officer. Website only: officer/index.html links no
 * manifest, so no browser offers to install it. There are no hiring or pay
 * screens here, and this bundle does not contain them.
 */
const TABS: Tab[] = [
  { path: "complaints", label: "Complaints", icon: "gavel" },
  { path: "disputes", label: "Disputed records", icon: "warning" },
  { path: "records", label: "All records", icon: "receipt_long" },
  { path: "accounts", label: "Accounts", icon: "badge" },
];

export default function OfficerApp() {
  const user = useAppSession("AUTHORITY");
  if (!user) return null;

  return (
    <AppShell user={user} tabs={TABS}>
      <Routes>
        <Route path="/complaints" element={<ComplaintsPage user={user} />} />
        <Route path="/disputes" element={<DisputedRecordsPage />} />
        <Route path="/records" element={<LedgerView />} />
        <Route path="/accounts" element={<AccountsPage />} />
        <Route path="*" element={<FirstTab tabs={TABS} />} />
      </Routes>
    </AppShell>
  );
}
