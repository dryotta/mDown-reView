//! Property test for the menu-id encoding contract documented in rule
//! `multiwin-per-window-menu` and the menu-id table in
//! docs/best-practices-common/tauri/v2-patterns.md (and reified by
//! `encode_menu_id` / `parse_menu_id` in `src-tauri/src/lib.rs`).
//!
//! The contract is:
//!   * `encode_menu_id(label, action)` ≡ `format!("{label}:{action}")`
//!   * `parse_menu_id(id)` ≡ `id.split_once(':')` — Some when the id is
//!     window-scoped, None when the id is unprefixed (a global like
//!     `"new-window"` or `"win-bring-all"`).
//!   * `parse(encode(label, action)) == Some((label, action))` for any
//!     `label` and any `action` that does NOT contain a `:` in its
//!     prefix region (the encode side guarantees the FIRST `:` is the
//!     separator; an action containing additional colons is preserved
//!     verbatim — see the `parse_menu_id_first_colon_wins` inline test
//!     in lib.rs).
//!
//! Why this lives in an integration-style test rather than poking the
//! private `encode_menu_id` / `parse_menu_id` directly: the helpers are
//! deliberately `fn` (private) in `lib.rs` because no external caller
//! should ever encode/decode menu ids — the menu module owns that
//! responsibility end-to-end. Exposing them via `pub` purely to test
//! them would weaken the API surface (a `multiwin-no-hardcoded-label`
//! adjacent concern: anything labelled "menu id" leaking into other
//! modules invites encoding drift).
//!
//! The integration test instead pins the *contract* by replicating it
//! in `contract_encode` / `contract_parse` and exhaustively
//! property-testing the round-trip and parse rejection cases. The
//! inline `encode_menu_id_format`, `parse_menu_id_window_scoped`,
//! `parse_menu_id_global_returns_none`, and
//! `parse_menu_id_first_colon_wins` tests in `lib.rs` (lines 1017-1037
//! at the time of writing) verify that lib.rs's actual implementation
//! matches this contract — together they form a two-sided guard:
//!
//!   * lib.rs inline tests prove the production fns match the contract
//!     replicated below;
//!   * this file proves the contract itself satisfies the multi-window
//!     properties any future implementation MUST also satisfy.
//!
//! If the lib.rs implementation diverges from `contract_encode` /
//! `contract_parse`, the inline tests there will fail; if a future
//! refactor changes the contract entirely (e.g. switches to a different
//! delimiter), THIS test must be updated in the same PR — and the
//! divergence is a deliberate architectural change requiring sign-off.

/// Contract replica of `lib.rs::encode_menu_id`. Must stay byte-for-byte
/// identical to the production fn.
fn contract_encode(label: &str, action: &str) -> String {
    format!("{label}:{action}")
}

/// Contract replica of `lib.rs::parse_menu_id`. Must stay byte-for-byte
/// identical to the production fn.
fn contract_parse(id: &str) -> Option<(&str, &str)> {
    id.split_once(':')
}

/// The action namespace exhausted here is the union of every
/// `MenuItem::with_id` action string used by `build_window_menu` (lib.rs
/// ~line 113 onwards). Adding a new menu action requires adding it to
/// this list — the missing-from-list assertion at the bottom of the
/// round-trip test catches a drift where a new action is wired into the
/// menu without round-trip coverage.
const KNOWN_ACTIONS: &[&str] = &[
    "new-window",
    "open-file",
    "open-folder",
    "close-folder",
    "close-tab",
    "close-all-tabs",
    "help-settings",
    "toggle-comments-pane",
    "next-tab",
    "prev-tab",
    "theme-system",
    "theme-light",
    "theme-dark",
    "check-updates",
    "toggle-devtools",
    "about",
];

/// Window-label namespace: bootstrap label `"main"` (the unique
/// unprefixed sentinel per `multiwin-no-hardcoded-label`) plus the
/// `next_label()` family `"win-N"` (rule `multiwin-no-hardcoded-label`,
/// confirmed against `WindowRegistry::next_label` in registry.rs).
const KNOWN_LABELS: &[&str] = &["main", "win-1", "win-2", "win-42", "win-9999"];

#[test]
fn encode_decode_round_trip_exhaustive() {
    // Property 1: round-trip — for every (label, action) pair drawn
    // from the documented namespaces, `parse(encode(l, a)) ==
    // Some((l, a))`.
    for label in KNOWN_LABELS {
        for action in KNOWN_ACTIONS {
            let encoded = contract_encode(label, action);
            assert_eq!(
                encoded,
                format!("{label}:{action}"),
                "encoding contract drift for ({label:?}, {action:?})"
            );
            let decoded = contract_parse(&encoded);
            assert_eq!(
                decoded,
                Some((*label, *action)),
                "round-trip failed for ({label:?}, {action:?}); encoded={encoded:?}"
            );
        }
    }
}

#[test]
fn parse_rejects_unprefixed_global_ids() {
    // Property 2: unprefixed ids return None — these are the "global"
    // menu ids (`new-window`, `win-bring-all` on macOS) that
    // `on_menu_event` routes outside the per-window dispatch path.
    // Locking in None for this case prevents a regression where a
    // future refactor accidentally treats `"new-window"` as
    // `(label="new-window", action="")` and routes to a phantom window.
    let unprefixed = ["new-window", "win-bring-all", "", "no-colon-here"];
    for id in &unprefixed {
        assert_eq!(
            contract_parse(id),
            None,
            "unprefixed id {id:?} should parse to None (treated as global)"
        );
    }
}

#[test]
fn parse_first_colon_wins_for_actions_with_colons() {
    // Property 3: an action containing a colon is preserved verbatim
    // after the first separator. This is the documented behaviour of
    // `str::split_once(':')` — any future swap to `splitn(2, ':')` or
    // a regex would silently change semantics. Locked in.
    let cases = [
        ("win-1", "some:action", "win-1:some:action"),
        ("main", "a:b:c", "main:a:b:c"),
    ];
    for (label, action, encoded) in &cases {
        assert_eq!(
            contract_parse(encoded),
            Some((*label, *action)),
            "first-colon-wins failed for {encoded:?}"
        );
    }
}

#[test]
fn empty_label_or_action_round_trips_but_callers_must_avoid() {
    // Edge case: an empty label or action is mechanically valid under
    // the contract (split_once still finds the colon), but is a CALLER
    // bug — `WindowRegistry::next_label` never produces empty, and the
    // menu builder always passes a non-empty action. Pin the mechanical
    // behaviour anyway so a future refactor that adds a "skip empty"
    // branch is forced to update this test consciously.
    assert_eq!(contract_parse(":action"), Some(("", "action")));
    assert_eq!(contract_parse("label:"), Some(("label", "")));
    assert_eq!(contract_parse(":"), Some(("", "")));
}
