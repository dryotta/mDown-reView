/**
 * Inline placeholder for tier-3 (system / blocked) link or asset
 * references (issue #338 / AC8).
 *
 * Privacy-first: the full path is forwarded only via the `title=` attribute
 * for power-user diagnosis; the visible body is a fixed string so the
 * blocked path cannot leak via screenshots or accidental copy/paste of
 * rendered text.
 *
 * Renders as a React text node — no `dangerouslySetInnerHTML`. Safe to
 * embed inline anywhere a `<span>` is permitted.
 */

export interface Tier3PlaceholderProps {
  /** The blocked path. Forwarded to `title=` for diagnosis. NEVER rendered as text. */
  path: string;
  /** Optional category label for clarity. Default: "system location". */
  category?: string;
}

export function Tier3Placeholder({
  path,
  category = "system location",
}: Tier3PlaceholderProps) {
  return (
    <span className="tier3-placeholder" data-tier="blocked" title={path}>
      🚫 Blocked: {category}
    </span>
  );
}
