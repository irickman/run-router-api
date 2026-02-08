Addressed remaining issues:
- Enforced link-penalty: landmark legs now track used edges, re-route with alternatives when overlap >5%, and shared-edge ratio is measured per leg.
- Shared-edge logic centralized (edgeKeys/sharedEdgeRatioSets); penalizedRoute hook in place, overlap enforced.
- Loop overlap post-check stays at <5% shared edges.
