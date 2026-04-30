import React from "react";
import ReactDOM from "react-dom/client";
import * as logger from "@/logger";
import { recordStartupPhase } from "@/lib/tauri-commands";
import App from "@/App";
import "@/styles/settings-view.css";

// Issue #264 / PR3 — startup tracing placeholder. PR4 will move this to
// a pre-React inline script in `index.html` so the phase fires before
// Vite-injected modules even parse (FOUC mitigation pairs with
// `theme-applied`). For now we report from the renderer entry point
// — close enough for log-analysis purposes; the schema slot is what
// matters for `analyze-log` (PR4). Errors swallowed: telemetry is
// non-essential and missing IPC (e.g. unit tests / headless harnesses)
// must not break the main render path.
void recordStartupPhase("theme-applied").catch(() => {});

// Install global error handlers before React initializes so that errors
// during module loading or the first render are captured.
// `addEventListener` preserves any handler Vite/devtools may have already
// installed — `window.onerror = …` would clobber them.
window.addEventListener("error", (event) => {
  const error = event.error;
  const stack = error instanceof Error ? error.stack : undefined;
  void logger.error(
    `Uncaught error: ${event.message} at ${event.filename}:${event.lineno}:${event.colno}\n${stack ?? ""}`
  );
});

window.addEventListener("unhandledrejection", (event) => {
  const reason =
    event.reason instanceof Error
      ? (event.reason.stack ?? event.reason.message)
      : String(event.reason);
  void logger.error(`Unhandled promise rejection: ${reason}`);
});

// Suppress the WebView's default OS context menu everywhere in the renderer.
// The app does not ship any in-app context menu — every right-click is a
// hard suppression. DevTools remain reachable via the native menu — Window →
// Toggle Developer Tools (F12) — in both debug and release builds.
// See `docs/architecture.md` rule 29.
window.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
