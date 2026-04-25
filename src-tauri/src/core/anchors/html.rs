use super::MatchOutcome;
use crate::core::types::Anchor;

// B-wave: real heuristics land in iter <n>.
pub fn resolve_range(_anchor: &Anchor) -> MatchOutcome {
    MatchOutcome::FileLevel
}

// B-wave: real heuristics land in iter <n>.
pub fn resolve_element(_anchor: &Anchor) -> MatchOutcome {
    MatchOutcome::FileLevel
}
