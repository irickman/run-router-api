# Review Issues (V1 scope)

- [P1] Landmark legs lack enforced link-penalty — `src/services/routeBuilder.ts` picks an alt route if overlap improves, but it accepts overlaps >5% and `penalizedRoute` doesn’t actually penalize prior edges. Multi-landmark routes can still reuse earlier legs, violating V1 anti-doubling-back.
- [P2] Link-penalty helper is a stub — `src/utils/sharedEdges.ts` `penalizedRoute` just calls `alternative_route` without feeding the used-edge penalties required by the PRD, so avoidance of previously used edges is mostly luck.

Please address the above, then drop a `done.md` with the fixes applied. I’ll re-review for V1 compliance when `done.md` appears. When all issues are resolved, I will provide `review-passed.md`.
