import { useState, type ReactNode } from "react";

export type SectionStatus = "pending" | "done" | "unsupported" | "error";

export interface SectionShellProps {
  title: string;
  description: string;
  status: SectionStatus;
  primaryLabel?: string;
  onPrimary?: () => void | Promise<void>;
  secondaryLabel?: string;
  onSecondary?: () => void | Promise<void>;
  error?: string;
  helpText?: ReactNode;
  collapsedByDefault?: boolean;
  /** Hide the status pill (used for purely informational sections). */
  hideStatus?: boolean;
}

const STATUS_LABELS: Record<SectionStatus, string> = {
  pending: "Not set up",
  done: "Done",
  unsupported: "Unsupported",
  error: "Error",
};

export function SectionShell(props: SectionShellProps) {
  const [pendingPrimary, setPendingPrimary] = useState(false);
  const [pendingSecondary, setPendingSecondary] = useState(false);

  const wrap = (
    handler: (() => void | Promise<void>) | undefined,
    setBusy: (b: boolean) => void,
  ) => async () => {
    if (!handler) return;
    setBusy(true);
    try {
      await handler();
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <div className="section-shell-header">
      <h3 className="section-shell-title">{props.title}</h3>
      {!props.hideStatus && (
        <span
          className={`section-shell-pill section-shell-pill-${props.status}`}
          data-testid="section-status"
        >
          {STATUS_LABELS[props.status]}
        </span>
      )}
    </div>
  );

  const rest = (
    <>
      <p className="section-shell-description">{props.description}</p>
      {(props.primaryLabel || props.secondaryLabel) && (
        <div className="section-shell-buttons">
          {props.primaryLabel && (
            <button
              type="button"
              className="section-shell-btn section-shell-btn-primary"
              onClick={wrap(props.onPrimary, setPendingPrimary)}
              disabled={pendingPrimary || pendingSecondary || !props.onPrimary}
            >
              {pendingPrimary ? "Working…" : props.primaryLabel}
            </button>
          )}
          {props.secondaryLabel && (
            <button
              type="button"
              className="section-shell-btn"
              onClick={wrap(props.onSecondary, setPendingSecondary)}
              disabled={pendingPrimary || pendingSecondary || !props.onSecondary}
              data-testid="section-secondary"
            >
              {pendingSecondary ? "Working…" : props.secondaryLabel}
            </button>
          )}
        </div>
      )}
      {props.helpText && (
        <div className="section-shell-help">{props.helpText}</div>
      )}
      {props.error && (
        <div className="section-shell-error" role="alert">
          {props.error}
        </div>
      )}
    </>
  );

  if (props.collapsedByDefault) {
    return (
      <details className="section-shell">
        <summary className="section-shell-summary">{header}</summary>
        {rest}
      </details>
    );
  }

  return (
    <div className="section-shell">
      {header}
      {rest}
    </div>
  );
}
