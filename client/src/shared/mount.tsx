import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";

/**
 * Start one app. Each entry's main.tsx calls this. ADR-0012.
 *
 * `basename` is the app's own address, such as "/worker". Every route and
 * link inside the app is then relative to it, so the worker app's "/work" is
 * really "/worker/work" in the address bar, and the browser's Back and Forward
 * buttons move between pages of this app.
 *
 * The sign-in page passes no basename and uses no router, because it has one
 * screen and leaves for another app as soon as someone signs in.
 */
export function mount(app: ReactNode, basename?: string) {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>{basename ? <BrowserRouter basename={basename}>{app}</BrowserRouter> : app}</StrictMode>,
  );
}
