/**
 * Inline placeholder for blocked remote images in MarkdownViewer.
 *
 * Shown when a markdown document references an `https://` image and the user
 * has not opted in via the per-document "Allow remote images" banner, OR when
 * the URL uses an insecure / unsupported scheme (e.g. `http://`).
 *
 * Inline styles are intentional — keeps this leaf component CSS-free so it can
 * be dropped anywhere without touching the global stylesheet.
 */
interface Props {
  url: string;
  reason?: "blocked" | "insecure";
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function RemoteImagePlaceholder({ url, reason = "blocked" }: Props) {
  const host = safeHostname(url);
  const label =
    reason === "insecure"
      ? `🖼 blocked: insecure scheme (${host})`
      : `🖼 remote image blocked — ${host}`;
  return (
    <span
      className="remote-image-placeholder"
      data-remote-image-placeholder
      data-reason={reason}
      title={url}
      style={{
        display: "inline-block",
        padding: "4px 8px",
        margin: "2px 0",
        fontSize: 12,
        color: "var(--color-text-secondary, #6e7781)",
        background: "var(--color-canvas-subtle, #f6f8fa)",
        border: "1px dashed var(--color-border, #d0d7de)",
        borderRadius: 4,
        fontFamily: "var(--font-mono, monospace)",
      }}
    >
      {label}
    </span>
  );
}
