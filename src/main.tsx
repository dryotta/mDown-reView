import React from "react";
import ReactDOM from "react-dom/client";
import * as logger from "@/logger";
import App from "@/App";
import "@/styles/settings-view.css";

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
