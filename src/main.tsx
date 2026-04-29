import React from "react";
import ReactDOM from "react-dom/client";
import * as logger from "@/logger";
import { recordStartupPhase } from "@/lib/tauri-commands";
import App from "@/App";
import "@/styles/settings-view.css";

// Issue #265 / PR4 — `theme-applied` is now wired against the FOUC
// script in `index.html`, which runs synchronously in `<head>` BEFORE
// this module is fetched. By the time we reach this line the
// `<html data-theme="…">` attribute is already set and app.css's
// theme tokens are already correct, so the recorder timestamp here
// faithfully captures the post-theme moment in the cold-startup
// timeline. Errors swallowed: telemetry is non-essential and missing
// IPC (e.g. unit tests / headless harnesses) must not break the main
// render path.
void recordStartupPhase("theme-applied").catch(() => {});

// Install global error handlers before React initializes so that errors
// during module loading or the first render are captured.
window.onerror = (message, source, lineno, colno, error) => {
  const stack = error?.stack ?? "";
  void logger.error(`Uncaught error: ${message} at ${source}:${lineno}:${colno}\n${stack}`); // fire-and-forget — global handler signature is sync
};

window.onunhandledrejection = (event) => {
  const reason =
    event.reason instanceof Error
      ? (event.reason.stack ?? event.reason.message)
      : String(event.reason);
  void logger.error(`Unhandled promise rejection: ${reason}`); // fire-and-forget — global handler signature is sync
};

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
