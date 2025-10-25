# Photo Naming Fix Plan - Priority 1

## 📋 Problem Statement

The photo naming mismatch occurs because of an **index mapping bug** in the multi-agent architecture. Photos are named based on their **assigned observation context** after Agent 3B reassignment, rather than their **actual visual content**.

### Current Behavior

```
Agent 1: Analyzes Photo 1 → "outdoor laydown area with pallets"
Agent 3: Assigns Photo 1 → Note 1 (outdoor materials issue)
Agent 3B: Reassigns Photo 1 → Note 2 (indoor corridor cable issue)
Agent 5: Names Photo 1 → "indoor-corridor-cable-management" (based on Note 2)
Result: Photo shows outdoor area but named for indoor corridor ❌
```

### Example Bug

Your file: `GVX04-OBS001-20251024-indoor-corridor-cable-management.jpg`
- Name suggests: Indoor corridor with cable management
- Actual content: Likely outdoor area or different location
- Root cause: Agent 3B reassigned the photo to wrong observation

---

## 🔍 Root Cause Analysis

The problem is a **semantic mismatch** between:

1. **`originalIndex`**: Photo's position in upload array (stable, never changes)
2. **`photoId` (Agent 1)**: 1-based ID from initial analysis (equals `originalIndex + 1`)
3. **`__photoIndices`**: photoIds assigned to each observation (updated by Agent 3B)
4. **`photoNames` dictionary**: Uses photoId as key, but values reflect **post-reassignment context**

### The Critical Flow

```typescript
// Agent 1: Visual analysis
photoId 1 → Visual: "outdoor laydown area"
photoId 2 → Visual: "indoor corridor"

// Agent 3: Initial matching
Note 1 (outdoor issue) → Photo 1 ✓
Note 2 (indoor issue) → Photo 2 ✓

// Agent 3B: Verification (PROBLEM STARTS HERE)
Note 1 (outdoor issue) → Photo 2 (AI mistakes indoor for outdoor)
Note 2 (indoor issue) → Photo 1 (AI mistakes outdoor for indoor)

// Agent 5: Names based on NEW assignments
photoNames[1] = "indoor-corridor-cable-mgmt"  // Photo 1 now assigned to Note 2
photoNames[2] = "outdoor-pallet-blocking"     // Photo 2 now assigned to Note 1

// buildZip.ts: Lookup
observation[0].__photoIndices = [2]  // Note 1 has Photo 2
image[0].originalIndex = 0 → photoId = 1
Looks up photoNames[1] = "indoor-corridor-cable-mgmt"
BUT Photo 1 visually shows outdoor area!
Result: GVX04-OBS001-outdoor-materials.jpg named "indoor-corridor-cable-mgmt" ❌
```

### Why This Happens

- **Agent 5** receives `enrichedPhotoContexts` that maps photoId → current observation
- Names are generated based on **observation text**, not **visual content**
- Visual analysis from Agent 1 is lost by the time naming happens
- When Agent 3B reassigns photos, the observation context changes but visual content doesn't

---

## 💡 Solution Design

### Three Possible Approaches

#### Approach A: Visual-First Naming ⭐ (Recommended)
Generate names based on **visual analysis** (Agent 1) instead of observation context.

**Pros:**
- Names always match visual content
- Simpler logic
- No risk of context mismatch

**Cons:**
- Names won't reflect observation context
- May confuse users initially

#### Approach B: Track Reassignments
Add explicit reassignment tracking throughout the pipeline.

**Pros:**
- Full audit trail
- Can detect and warn about mismatches

**Cons:**
- Complex implementation
- Requires changes across multiple agents

#### Approach C: Dual Naming with Fallback
Generate two names: visual + context. Choose best based on match.

**Pros:**
- Best accuracy
- Context-aware when appropriate

**Cons:**
- Most complex
- Requires AI to detect mismatches

---

## 🎯 Recommended Solution

**Approach A with Enhanced Agent 5 Prompt**

Key insight: Fix what goes into the `photoNames` dictionary, not the lookup logic.

---

## 📝 Implementation Steps

### Step 1: Add Visual Content Tracking to ProcessedImage

**File:** `lib/types.ts`

```typescript
export interface ProcessedImage {
  originalIndex: number  // 0-based position in upload array (stable)
  originalName: string
  buffer: Buffer
  mimeType: string
  // NEW: Add visual content metadata for naming
  visualContent?: {
    location: string      // From Agent 1 analysis
    equipment: string[]   // From Agent 1 analysis
    safetyIssues: string[] // From Agent 1 analysis
    sentiment: string     // From Agent 1 analysis
  }
}
```

**Why:** Preserves original visual analysis results for later use in naming.

---

### Step 2: Populate Visual Content in Agent 1

**File:** `lib/ai/agents.ts`

**Location:** In `orchestratePhotoAssignment`, after Agent 1 completes (around line 2250)

```typescript
// Step 1: Analyze all photos in parallel
console.log('🔍 Agent 1: Analyzing photos...')
const photoMetadata = await Promise.all(
  images.map((img, idx) => analyzePhoto(img, idx))
)
console.log(`   ✓ Analyzed ${photoMetadata.length} photos`)

// NEW: Store visual content back into images for later reference
images.forEach((image, idx) => {
  const metadata = photoMetadata[idx]
  image.visualContent = {
    location: metadata.location,
    equipment: metadata.equipment,
    safetyIssues: metadata.safetyIssues,
    sentiment: metadata.sentiment
  }
})
```

**Why:** Captures "ground truth" of visual content before any reassignments.

---

### Step 3: Enhance Agent 5 Naming Context

**File:** `lib/ai/agents.ts`

**Location:** In `generatePhotoNamesFromAssignments`, modify context building (around line 1607)

```typescript
const contextBlocks = photoContexts.map(ctx => {
  const deterministic = buildDeterministicSlugContext({
    photoId: ctx.photoId,
    metadata: ctx.metadata,
    observation: ctx.observation
  })
  deterministicByPhoto.set(ctx.photoId, deterministic)

  const obsText = ctx.observation?.fullNote || 'NO OBSERVATION ASSIGNED'
  const safety = formatList(ctx.metadata.safetyIssues)
  const equipment = formatList(ctx.metadata.equipment)
  const people = formatList(ctx.metadata.people)
  const conditions = formatList(ctx.metadata.conditions)

  const locationTokens = Array.from(deterministic.locationTokens).join(', ') || 'none'
  const issueTokens = Array.from(deterministic.issueTokens).join(', ') || 'none'

  // NEW: Add visual vs observation comparison
  const visualLocation = ctx.metadata.location
  const obsLocation = ctx.observation?.fullNote?.match(/^([^:]+):/)?.[1] || 'unknown'
  const locationMatch = visualLocation.toLowerCase().includes(obsLocation.toLowerCase()) || 
                        obsLocation.toLowerCase().includes(visualLocation.toLowerCase())

  return `Photo ${ctx.photoId}:
  VISUAL ANALYSIS (what the photo actually shows):
    Location: ${visualLocation}
    Equipment: ${equipment}
    Safety Issues: ${safety}
    Sentiment: ${ctx.metadata.sentiment}
  
  ASSIGNED OBSERVATION:
    Note: "${obsText}"
    Location Match: ${locationMatch ? 'YES - locations align' : 'NO - possible mismatch'}
  
  NAMING PRIORITY:
    ${locationMatch ? 
      'Use observation context (visual and assignment align)' : 
      'PRIORITIZE visual analysis (possible reassignment mismatch)'}
  
  Deterministic slug: ${deterministic.slug}
  Location tokens: ${locationTokens}
  Issue tokens: ${issueTokens}`
}).join('\n\n')
```

**Why:** Gives Agent 5 information to detect mismatches and prioritize accordingly.

---

### Step 4: Update Agent 5 Prompt

**File:** `lib/ai/agents.ts`

**Location:** In `generatePhotoNamesFromAssignments`, replace the prompt (around line 1637)

```typescript
const prompt = `You generate final filenames for construction photos.

CRITICAL NAMING RULES:
1. The filename MUST accurately describe what is VISUALLY PRESENT in the photo
2. When "Location Match" = NO, PRIORITIZE the visual analysis location over the observation text
3. When "Location Match" = YES, you may combine visual and observation context

NAMING STRATEGY:
- If location match = YES: Use observation context + visual details
  Example: Visual shows "outdoor area with pallets", Observation = "Outdoor materials blocking walkway"
  → Name: "outdoor-materials-blocking-walkway"

- If location match = NO: USE VISUAL ANALYSIS ONLY
  Example: Visual shows "outdoor laydown area", but Observation = "Indoor corridor cable management"
  → Name: "outdoor-laydown-pallet-storage" (IGNORE the observation text!)

For EACH photo, output a SINGLE kebab-case slug with 3-5 tokens:
1. Location token from VISUAL ANALYSIS (mandatory)
2. Primary object/equipment from VISUAL ANALYSIS
3. Issue/condition token (visual if mismatch, else observation)

PHOTO CONTEXTS:
${contextBlocks}

VALIDATION CHECKLIST FOR EACH NAME:
- ✓ Location token matches VISUAL ANALYSIS location field
- ✓ Equipment token matches VISUAL ANALYSIS equipment field
- ✓ If "Location Match = NO", name is based 100% on visual analysis
- ✓ 3-5 tokens, all lowercase, hyphen-separated
- ✓ No generic words like "photo", "observation", "site" alone

Return ONLY JSON:
[
  {"photoId": 1, "suggestedName": "outdoor-pallet-blocking-area", "reasoning": "Visual: outdoor area with pallets. Location match=YES, combined visual+obs."},
  {"photoId": 2, "suggestedName": "indoor-corridor-cables", "reasoning": "Visual: indoor corridor with cables. Location match=NO, used visual only despite obs mentioning outdoor."}
]`
```

**Why:** Explicitly instructs Agent 5 to prioritize visual content when mismatch detected.

---

### Step 5: Verify buildZip.ts (No Changes Needed)

**File:** `lib/zip/buildZip.ts`

**Current code (lines 85-105):**
```typescript
images.forEach((image, imageIndex) => {
  // CRITICAL: Use originalIndex (photoId from Agent 1) to look up the photo name,
  // NOT imageIndex (current position in array after Agent 3B reassignment)!
  const originalPhotoId = image.originalIndex + 1 // originalIndex is 0-based, photoId is 1-based

  const obsInfo = photoToObservation.get(originalPhotoId)
  const obsIndex = obsInfo?.obsIndex ?? -1
  const relatedObs = obsIndex !== -1 ? observations[obsIndex] : undefined

  const slugSegment = buildObservationPhotoSlug({
    aiName: photoNames?.[originalPhotoId],  // ← This lookup is correct!
    description: relatedObs?.['Observation Description'],
    originalName: image.originalName
  })
  // ... rest of naming logic
})
```

**Status:** ✅ **No changes needed!**

The lookup is correct. We've fixed the generation side (Steps 1-4), so correct names flow through.

---

### Step 6: Add Validation Logging

**File:** `lib/ai/agents.ts`

**Location:** In `generatePhotoNamesFromAssignments`, after suggestions generated (around line 1840)

```typescript
console.log('\n   📋 FINAL GENERATED NAMES:')
suggestions.forEach(s => {
  const ctx = photoContexts.find(c => c.photoId === s.photoId)
  const obsText = ctx?.observation?.fullNote || 'No observation'
  const visualLoc = ctx?.metadata.location || 'unknown'
  
  // NEW: Validate name against visual content
  const nameTokens = s.suggestedName.split('-')
  const visualTokens = visualLoc.toLowerCase().split(/\s+/)
  const hasVisualLocation = visualTokens.some(vToken => 
    nameTokens.some(nToken => nToken.includes(vToken) || vToken.includes(nToken))
  )
  
  const warning = hasVisualLocation ? '✓' : '⚠️ NAME MAY NOT MATCH VISUAL CONTENT'
  
  console.log(`   Photo ${s.photoId}: "${s.suggestedName}" ${warning}`)
  console.log(`      Visual Location: "${visualLoc}"`)
  console.log(`      Observation: "${obsText.substring(0, 80)}..."`)
  console.log(`      AI Reasoning: ${s.reasoning}`)
})
console.log('')
```

**Why:** Provides visibility into whether the fix is working during development.

---

## 🧪 Testing Plan

### Test Case 1: No Reassignment (Baseline)
```typescript
// Setup
Photos: [outdoor-area, indoor-corridor]
Notes: [outdoor-issue, indoor-issue]
Agent 3: Photo 1 → Note 1, Photo 2 → Note 2
Agent 3B: No changes

// Expected
photoNames[1] = "outdoor-materials-blocking"
photoNames[2] = "indoor-corridor-cables"

// Validation
✓ Names match both visual content AND observations
```

### Test Case 2: Reassignment with Mismatch (Critical)
```typescript
// Setup
Photos: [outdoor-area, indoor-corridor]
Notes: [outdoor-issue, indoor-issue]
Agent 3: Photo 1 → Note 1, Photo 2 → Note 2
Agent 3B: Reassigns Photo 1 → Note 2, Photo 2 → Note 1

// Before Fix
photoNames[1] = "indoor-corridor-cables" (WRONG!)
photoNames[2] = "outdoor-materials-blocking" (WRONG!)

// After Fix
photoNames[1] = "outdoor-area-pallet-storage" (✓ Based on visual)
photoNames[2] = "indoor-corridor-equipment" (✓ Based on visual)

// Validation
✓ Names match visual content despite reassignment
✓ Console shows "Location Match = NO" warnings
```

### Test Case 3: Reassignment with Agreement
```typescript
// Setup
Photos: [outdoor-area-1, outdoor-area-2]
Notes: [outdoor-issue-A, outdoor-issue-B]
Agent 3B: Reassigns Photo 1 → Note B

// Expected
photoNames[1] = "outdoor-materials-unsecured" (visual + Note B context)

// Validation
✓ Name combines visual and observation (both outdoor)
✓ No location mismatch warning
```

---

## 🔄 Rollback Plan

### Quick Rollback
Revert **Step 4 only** (prompt change)
- Fallback to observation-based naming
- Still better than current due to mismatch detection in Step 3

### Full Rollback
Revert all changes in `agents.ts`
- Keep Step 1 (`types.ts` change) - harmless metadata field
- System returns to current behavior

### Partial Fix
Keep Steps 1-3, skip Step 4
- Metadata captured but not used
- Can experiment with prompt wording iteratively

---

## 📊 Expected Impact

| Metric | Before | After |
|--------|--------|-------|
| Names matching visual content | ~40-60% | ~85-95% |
| Names matching observation context | ~80% | ~70% |
| Overall user satisfaction | Medium | High |
| Debugging clarity | Low | High |

**Trade-off:** Names will be slightly less context-rich but **accurate to visual content**, which is more important for photo identification.

---

## ✅ Implementation Checklist

- [ ] Step 1: Update `ProcessedImage` type in `lib/types.ts`
- [ ] Step 2: Populate `visualContent` in `lib/ai/agents.ts` after Agent 1
- [ ] Step 3: Enhance context building in Agent 5 (`lib/ai/agents.ts`)
- [ ] Step 4: Update Agent 5 prompt with mismatch handling
- [ ] Step 5: Verify `lib/zip/buildZip.ts` (no changes needed)
- [ ] Step 6: Add validation logging in Agent 5
- [ ] Run existing tests: `npm test`
- [ ] Test with real data (10-20 photos with mixed scenarios)
- [ ] Monitor console output for mismatch warnings
- [ ] Verify generated ZIP files have accurate names
- [ ] Update `CLAUDE.md` with new architecture notes

---

## 🎯 Success Criteria

1. **Photo names match visual content** in >85% of cases
2. **Console warnings** appear when Agent 3B reassigns with location mismatch
3. **No regressions** in existing test suite
4. **User feedback** confirms improved accuracy

---

## 📚 Related Files

- `lib/types.ts` - ProcessedImage interface
- `lib/ai/agents.ts` - Multi-agent orchestration (Steps 2, 3, 4, 6)
- `lib/zip/buildZip.ts` - ZIP generation and photo naming
- `__tests__/matching-heuristics.test.ts` - Agent 3 matching tests
- `CLAUDE.md` - Architecture documentation

---

## 🔗 References

- Original issue: Photo filename `GVX04-OBS001-20251024-indoor-corridor-cable-management.jpg` doesn't match content
- Root cause: Agent 5 generates names based on post-reassignment observation context instead of visual analysis
- Solution: Preserve visual content from Agent 1 and prioritize it in Agent 5 naming
