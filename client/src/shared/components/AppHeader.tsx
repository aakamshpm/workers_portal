import type { ReactNode } from "react";
import Icon from "./Icon";

/**
 * The bar at the top of every screen (ADR-0019).
 *
 * The app name is plain text, not a heading. Each screen asks one question and
 * that question is its only `h1`, so a screen reader user who jumps to the
 * first heading hears what the screen wants, not the app's name again.
 *
 * `children` sits at the end of the bar: the language list on the sign-in page,
 * and the reader's name and "Sign out" inside an app.
 */
export default function AppHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 bg-surface/95 shadow-sm backdrop-blur">
      <div className="mx-auto flex min-h-[var(--size-header)] max-w-7xl items-center justify-between gap-space-md px-margin max-[399px]:gap-space-sm">
        {/* The name stays on one line. Below 400px it drops its icon and
            steps down to 16px, which is what lets the longest name
            ("പണിക്കൂലി കണക്ക്") sit beside the controls on a 320px phone. */}
        <p className="flex min-w-0 items-center gap-space-sm font-headline-sm text-headline-sm whitespace-nowrap text-primary max-[399px]:font-body-lg-bold max-[399px]:text-body-lg-bold">
          <Icon name="receipt_long" size={24} className="shrink-0 max-[399px]:hidden" />
          <span className="truncate">{title}</span>
        </p>
        {children && <div className="flex shrink-0 items-center gap-space-sm">{children}</div>}
      </div>
    </header>
  );
}
