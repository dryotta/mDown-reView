/**
 * Generic exhaustiveness helper for tagged-union switches.
 *
 * The codebase has three domain-specific variants
 * (`assertNeverLinkRoute`, `assertNeverAnchorKind`,
 * `assertNeverFlashKind`); this is the type-only generic version for
 * use in cross-cutting UI hooks where a domain-specific name would be
 * pointless ceremony. Calling it on a value typed `never` triggers a
 * compile error at the call site if a tagged-union variant is ever
 * added without updating the switch — see
 * `docs/design-patterns.md` rule 24.
 *
 * The runtime body throws (rather than returning silently) so a
 * production-side discriminator drift (e.g. a Tauri minor renames a
 * variant) surfaces in logs instead of leaving the UI stuck.
 */
export function assertNever(x: never): never {
  throw new Error(
    `assertNever: unhandled discriminator value: ${JSON.stringify(x)}`,
  );
}
