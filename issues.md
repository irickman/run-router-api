# Review Issues (V1 scope)

- [P1] Loop edge disjointness/tuning — `src/services/loopGenerator.ts` still relies on GraphHopper `alternative_route` without measuring shared-edge overlap; max_share_factor is 0.3 (30%), while V1 acceptance requires <5% shared edges between outbound/return legs. No post-check of overlap is performed.
- [P2] Landmark legs lack link-penalty — `src/services/routeBuilder.ts` uses the alt-route for each landmark leg but doesn’t penalize or avoid edges used in prior legs, so multi-landmark routes may double back, diverging from V1 link-penalty requirement between legs.
- [P2] LLM prompt lacks examples — `src/clients/openaiClient.ts` adds defaults but omits the PRD’s required few-shot examples, reducing consistency of parameter extraction for common query patterns.

Please address the above, then drop a `done.md` with the fixes applied. I’ll re-review for V1 compliance when `done.md` appears. When all issues are resolved, I will provide `review-passed.md`.
