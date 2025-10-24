# Photo Naming & Matching Improvement Plan

**Overall Progress:** `0%`

## Tasks:

- [ ] 🟥 **Step 1: Refine export filename strategy**
  - [ ] 🟥 Implement new `Project-OBS###-YYYYMMDD-slug[-N].jpg` template in `lib/zip/buildZip.ts`
  - [ ] 🟥 Introduce slug helper enforcing ≤4 meaningful tokens and consistent sanitisation
  - [ ] 🟥 Update zip-related tests (incl. multi-photo cases) to cover the revised naming

- [ ] 🟥 **Step 2: Align AI-generated names with slug constraints**
  - [ ] 🟥 Trim and normalise AI photo name suggestions to the 4-token limit in `lib/ai/agents.ts`
  - [ ] 🟥 Ensure fallback slugs from observation descriptions follow the same helper logic
  - [ ] 🟥 Add/adjust unit tests for slug sanitisation and AI name processing

- [ ] 🟥 **Step 3: Improve photo-to-observation matching heuristics**
  - [ ] 🟥 Add structured similarity scoring between photo metadata and structured notes before AI matching
  - [ ] 🟥 Capture and propagate assignment confidence/telemetry for later UI surfacing
  - [ ] 🟥 Update orchestrator tests (or add targeted ones) to validate improved matching flow
