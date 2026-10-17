#![cfg(test)]

//! Property tests for the [`ScopeSet`] bitmask algebra (issue #1663).
//!
//! Textbook set-algebra properties over `contains` / `union` / `difference`
//! / `is_valid`: union subsumption, difference cancellation, reflexivity and
//! transitivity of `contains`, and rejection of undefined bits.

use super::ScopeSet;
use proptest::prelude::*;

fn arb_mask() -> impl Strategy<Value = u32> {
    prop::num::u32::ANY
}

proptest! {
    /// `a ⊆ a ∪ b` for arbitrary masks.
    #[test]
    fn union_subsumes_operands(a in arb_mask(), b in arb_mask()) {
        let a_set = ScopeSet(a);
        let b_set = ScopeSet(b);
        let u = a_set.union(&b_set);
        prop_assert!(u.contains(&a_set), "a ⊆ a ∪ b failed for a={a:#x}, b={b:#x}");
        prop_assert!(u.contains(&b_set), "b ⊆ a ∪ b failed for a={a:#x}, b={b:#x}");
    }

    /// `(a ∪ b) \ b ⊆ a`: removing `b` from the union leaves only `a` bits.
    #[test]
    fn union_then_difference_is_subsumed(a in arb_mask(), b in arb_mask()) {
        let a_set = ScopeSet(a);
        let b_set = ScopeSet(b);
        let back = a_set.union(&b_set).difference(&b_set);
        prop_assert!(
            a_set.contains(&back),
            "(a ∪ b) \\ b ⊆ a failed for a={a:#x}, b={b:#x}, got {:#x}",
            back.0,
        );
    }

    /// `contains` is reflexive: `a ⊆ a`.
    #[test]
    fn contains_is_reflexive(a in arb_mask()) {
        prop_assert!(ScopeSet(a).contains(&ScopeSet(a)));
    }

    /// `contains` is transitive: `a ⊆ b` and `b ⊆ c` imply `a ⊆ c`.
    #[test]
    fn contains_is_transitive(a in arb_mask(), b in arb_mask(), c in arb_mask()) {
        let (sa, sb, sc) = (ScopeSet(a), ScopeSet(b), ScopeSet(c));
        prop_assume!(sb.contains(&sa) && sc.contains(&sb));
        prop_assert!(sc.contains(&sa));
    }

    /// Any mask with bits outside `ALL_DEFINED` is rejected by `is_valid`,
    /// and every submask of `ALL_DEFINED` is accepted.
    #[test]
    fn invalid_bits_are_rejected(a in arb_mask()) {
        let s = ScopeSet(a);
        prop_assert_eq!(s.is_valid(), (a & !ScopeSet::ALL_DEFINED) == 0);
    }

    /// `difference` never introduces bits outside its left operand.
    #[test]
    fn difference_is_submask(a in arb_mask(), b in arb_mask()) {
        let (sa, sb) = (ScopeSet(a), ScopeSet(b));
        prop_assert!(sa.contains(&sa.difference(&sb)));
    }
}
