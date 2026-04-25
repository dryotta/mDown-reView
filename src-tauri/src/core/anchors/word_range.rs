use super::MatchOutcome;
use crate::core::types::Anchor;

/// Stub matcher for [`Anchor::WordRange`]. Iter 3 ships only the wire
/// variant + Rust tokenizer; the real word-anchored heuristic (UAX #29
/// stream + fuzzy-on-line-text-hash recovery) is deferred to iter 4. Until
/// then the resolver returns `FileLevel`, matching the rung the other
/// typed-variant stubs use.
pub fn resolve(_anchor: &Anchor) -> MatchOutcome {
    MatchOutcome::FileLevel
}
