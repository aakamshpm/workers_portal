import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* BrowserRouter uses real addresses, so the browser's Back and Forward
      * buttons move between pages of this app instead of leaving it. */}
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
