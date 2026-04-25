use super::MatchOutcome;
use crate::core::types::Anchor;

// B-wave: real heuristics land in iter <n>.
pub fn resolve(_anchor: &Anchor) -> MatchOutcome {
    MatchOutcome::FileLevel
}
