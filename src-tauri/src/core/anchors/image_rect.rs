use super::MatchOutcome;
use crate::core::types::ImageRectAnchor;

/// Resolve an [`ImageRectAnchor`]. Coordinates are normalized to the unit
/// square [0,1] at creation time, so the heuristic is a pure bounds check —
/// file bytes are never inspected. Out-of-bounds is treated as `Orphan`
/// because a fractional coordinate outside [0,1] cannot be salvaged.
pub(crate) fn resolve(p: &ImageRectAnchor) -> MatchOutcome {
    let unit = |v: f32| (0.0..=1.0).contains(&v);
    if !unit(p.x_pct) || !unit(p.y_pct) {
        return MatchOutcome::Orphan;
    }
    if p.w_pct.is_some_and(|w| !unit(w)) {
        return MatchOutcome::Orphan;
    }
    if p.h_pct.is_some_and(|h| !unit(h)) {
        return MatchOutcome::Orphan;
    }
    MatchOutcome::Exact
}

#[cfg(test)]
mod tests {
    use super::*;

    fn anchor(x: f32, y: f32, w: Option<f32>, h: Option<f32>) -> ImageRectAnchor {
        ImageRectAnchor {
            x_pct: x,
            y_pct: y,
            w_pct: w,
            h_pct: h,
        }
    }

    #[test]
    fn valid_coords_exact() {
        assert_eq!(
            resolve(&anchor(0.5, 0.25, Some(0.1), Some(0.2))),
            MatchOutcome::Exact
        );
    }

    #[test]
    fn x_out_of_bounds_orphan() {
        assert_eq!(resolve(&anchor(1.5, 0.5, None, None)), MatchOutcome::Orphan);
    }

    #[test]
    fn w_out_of_bounds_orphan() {
        assert_eq!(
            resolve(&anchor(0.0, 0.0, Some(1.5), None)),
            MatchOutcome::Orphan
        );
    }

    #[test]
    fn all_zero_exact() {
        assert_eq!(
            resolve(&anchor(0.0, 0.0, Some(0.0), Some(0.0))),
            MatchOutcome::Exact
        );
    }
}
