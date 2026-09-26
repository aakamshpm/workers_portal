import { Route, Routes, useNavigate, useSearchParams } from "react-router-dom";
import { AppShell, FirstTab, useAppSession, type Tab } from "../shared/AppShell";
import LedgerView from "../shared/LedgerView";
import ContractorDashboard from "./ContractorDashboard";
import PaymentProofPage from "./PaymentProofPage";

/**
 * The contractor app, at /contractor/. ADR-0012.
 *
 * Opens only for a contractor. The same app is the contractor's website and,
 * after the PWA step, his installed app. There is no Find Work and no
 * complaint desk here.
 */
const TABS: Tab[] = [
  { path: "workers", label: "My workers" },
  { path: "pay", label: "Pay a worker" },
  { path: "records", label: "All records" },
];

export default function ContractorApp() {
  const user = useAppSession("CONTRACTOR");
  if (!user) return null;

  return (
    <AppShell user={user} tabs={TABS}>
      <Routes>
        <Route path="/workers" element={<Workers />} />
        <Route path="/pay" element={<Pay />} />
        <Route path="/records" element={<LedgerView />} />
        <Route path="*" element={<FirstTab tabs={TABS} />} />
      </Routes>
    </AppShell>
  );
}

function Workers() {
  const navigate = useNavigate();
  return (
    <ContractorDashboard
      // The contract travels in the address, so this page can be reopened later
      // or shared, and Back returns to the worker list rather than leaving the app.
      onGoToPayment={(offerId) => navigate(`/pay?offer=${encodeURIComponent(offerId)}`)}
    />
  );
}

function Pay() {
  const [params] = useSearchParams();
  return <PaymentProofPage initialOfferId={params.get("offer") ?? undefined} />;
}
