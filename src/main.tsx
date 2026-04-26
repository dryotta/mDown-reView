import React from "react";
import ReactDOM from "react-dom/client";
import * as logger from "@/logger";
import App from "@/App";
import "@/styles/settings-view.css";

// Install global error handlers before React initializes so that errors
// during module loading or the first render are captured.
window.onerror = (message, source, lineno, colno, error) => {
  const stack = error?.stack ?? "";
  logger.error(`Uncaught error: ${message} at ${source}:${lineno}:${colno}\n${stack}`);
};

window.onunhandledrejection = (event) => {
  const reason =
    event.reason instanceof Error
      ? (event.reason.stack ?? event.reason.message)
      : String(event.reason);
  logger.error(`Unhandled promise rejection: ${reason}`);
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
