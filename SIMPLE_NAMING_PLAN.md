# Simple Photo Naming Plan

## 📋 Current vs Desired Naming

### Current (Complex):
```
GVX04-OBS001-20251024-indoor-corridor-cable-management.jpg
│     │       │        └─ AI-generated descriptive slug
│     │       └─ Date (YYYYMMDD)
│     └─ Observation number (OBS001, OBS002, etc.)
└─ Project code
```

### Desired (Simple):
```
20251024-001.jpg
│        └─ Sequential number (001, 002, 003...)
└─ Date (YYYYMMDD)
```

**Benefits:**
- ✅ Much simpler, easier to understand
- ✅ No AI processing needed for naming
- ✅ No dependency on observation assignments
- ✅ Faster processing (skip Agent 5)
- ✅ All photos included regardless of observation matching
- ✅ Sequential numbering is intuitive

---

## 🎯 What Changes

### Files to Modify:

#### 1. **lib/zip/buildZip.ts** (Main changes)
- **Current:** Complex naming with project, observation number, date, AI slug
- **New:** Simple sequential naming `{DATE}-{###}.jpg`
- **Preserve:** Manifest, CSV generation, folder structure

#### 2. **lib/files/rename.ts** (Add new function)
- **Add:** `generateSimpleSequentialName(date: string, index: number): string`
- **Preserve:** All existing functions (for backward compatibility)

#### 3. **lib/ai/agents.ts** (Skip Agent 5)
- **Current:** Agent 5 generates photo names
- **New:** Skip Agent 5 entirely in orchestration
- **Preserve:** Agents 1-4 (photo analysis, note parsing, matching, validation)

### What to Keep:

✅ **Observation CSV** - Still valuable for tracking observations  
✅ **Manifest JSON** - Maps original → renamed filenames  
✅ **Agent 1-4** - Photo analysis and observation enrichment  
✅ **All tests** - Ensure nothing breaks  
✅ **Image processing** - Normalization, HEIC conversion, resizing  

### What to Remove/Skip:

❌ **Agent 5** - No longer needed (photo naming)  
❌ **Complex slug generation** - Not needed for simple naming  
❌ **Photo-to-observation assignment for naming** - Photos just numbered sequentially  
❌ **Deduplication logic** - Sequential numbers are always unique  

---

## 🔧 Implementation Steps

### Step 1: Add Simple Naming Function (rename.ts)

**File:** `lib/files/rename.ts`

```typescript
/**
 * Generate simple sequential photo filename
 * Format: YYYYMMDD-###.jpg
 * 
 * @param date - Date string in YYYYMMDD format
 * @param index - 1-based photo index (1, 2, 3...)
 * @returns Filename like "20251024-001.jpg"
 */
export function generateSimpleSequentialName(
  date: string, 
  index: number
): string {
  // Ensure date is in YYYYMMDD format
  const cleanDate = date.replace(/[^0-9]/g, '').slice(0, 8)
  if (cleanDate.length !== 8) {
    throw new Error(`Invalid date format: ${date}. Expected YYYYMMDD.`)
  }
  
  // Pad index to 3 digits (001, 002, ...)
  const paddedIndex = String(index).padStart(3, '0')
  
  return `${cleanDate}-${paddedIndex}.jpg`
}
```

**Test cases:**
```typescript
generateSimpleSequentialName('20251024', 1)   // → "20251024-001.jpg"
generateSimpleSequentialName('20251024', 15)  // → "20251024-015.jpg"
generateSimpleSequentialName('20251024', 123) // → "20251024-123.jpg"
```

---

### Step 2: Update buildZip.ts (Simplify Naming Logic)

**File:** `lib/zip/buildZip.ts`

**Before (lines 51-120):**
```typescript
images.forEach((image, imageIndex) => {
  const originalPhotoId = image.originalIndex + 1
  const obsInfo = photoToObservation.get(originalPhotoId)
  const obsIndex = obsInfo?.obsIndex ?? -1
  const relatedObs = obsIndex !== -1 ? observations[obsIndex] : undefined

  const projectSegment = sanitizeProjectSegment(relatedObs?.Project || project)
  const observationNumber = obsIndex !== -1
    ? `OBS${String(obsIndex + 1).padStart(3, '0')}`
    : 'OBS000'
  const dateSegment = sanitizeDateSegment(
    relatedObs?.['Notification Date'],
    datePrefix
  )

  const slugSegment = buildObservationPhotoSlug({
    aiName: photoNames?.[originalPhotoId],
    description: relatedObs?.['Observation Description'],
    originalName: image.originalName
  })

  const suffix = obsInfo && obsInfo.total > 1
    ? `-${obsInfo.position + 1}`
    : ''

  const baseFilename = limitFilenameLength(
    [projectSegment, observationNumber, dateSegment, slugSegment]
      .filter(Boolean)
      .join('-') || `${projectSegment}-${observationNumber}-${dateSegment}-photo`
  )

  const finalName = `${baseFilename}${suffix}.jpg`
  const dedupedName = deduplicateFilename(finalName, usedFilenames)
  // ... rest
})
```

**After (MUCH SIMPLER):**
```typescript
import { generateSimpleSequentialName } from '../files/rename'

// ... in createZipStream function:

images.forEach((image, imageIndex) => {
  // Simple sequential naming: 20251024-001.jpg, 20251024-002.jpg, etc.
  const photoNumber = imageIndex + 1  // 1-based index
  const finalName = generateSimpleSequentialName(datePrefix, photoNumber)
  
  usedFilenames.add(finalName)
  archive.append(image.buffer, { name: `photos/${finalName}` })

  // Manifest: Still track original → renamed mapping
  // But no observation association for naming
  manifest.push({
    rowNumber: 0,  // No observation row (photos are independent)
    originalFilename: image.originalName,
    renamedFilename: finalName,
    observationDescription: 'Photo included in batch upload'  // Generic description
  })
})
```

**Changes:**
- ✅ 50+ lines → ~15 lines
- ✅ No photoNames lookup
- ✅ No observation mapping needed
- ✅ No complex slug generation
- ✅ No deduplication needed (sequential = always unique)

---

### Step 3: Skip Agent 5 in Orchestration (agents.ts)

**File:** `lib/ai/agents.ts`

**Before (lines 2970-2973):**
```typescript
const photoNames = await generatePhotoNamesFromAssignments(
  enrichedPhotoContexts, 
  images, 
  apiKey
)
console.log(`   ✓ Generated ${Object.keys(photoNames).length} photo names`)
```

**After:**
```typescript
// SKIPPED: Agent 5 photo naming (using simple sequential naming instead)
const photoNames = {}  // Empty - not used with simple naming
console.log('   ⏭️  Skipped Agent 5: Using simple sequential naming')
```

**Impact:**
- ⚡ Saves ~10-15 seconds per batch (no AI calls)
- 💰 Saves API costs (no Gemini calls for naming)
- ✅ Still returns photoNames for backward compatibility (just empty)

---

### Step 4: Update Manifest Structure (Optional)

**File:** `lib/types.ts`

**Current:**
```typescript
export interface ManifestEntry {
  rowNumber: number          // Observation row (1, 2, 3...)
  originalFilename: string   // User's original filename
  renamedFilename: string    // New filename in ZIP
  observationDescription: string  // Description from observation
}
```

**Option A: Keep as-is** (Safer)
- Set `rowNumber: 0` for all photos
- Set `observationDescription: 'Photo included in batch upload'`
- No breaking changes

**Option B: Simplify manifest** (Cleaner)
```typescript
export interface ManifestEntry {
  originalFilename: string   // User's original filename
  renamedFilename: string    // New filename in ZIP
  uploadIndex: number        // Original upload order (1, 2, 3...)
}
```

**Recommendation:** Use Option A (no breaking changes, still provides all info)

---

### Step 5: Update API Routes (Keep observation processing)

**Files:** `app/api/simple/route.ts`, `app/api/export/route.ts`

**Current behavior:**
1. User uploads photos + notes
2. AI analyzes photos → observations
3. Photos matched to observations
4. Complex naming based on observations
5. ZIP with CSV + photos

**New behavior:**
1. User uploads photos + notes
2. AI analyzes photos → observations (KEEP THIS)
3. ~~Photos matched to observations~~ (SKIP - not needed for naming)
4. Simple sequential naming (20251024-001.jpg)
5. ZIP with CSV + photos

**Changes needed:**
- Pass empty `photoNames: {}` to buildZip
- observations.csv still generated (valuable!)
- Photos just numbered sequentially

**No changes needed in:**
- `/api/analyze` - Still needed for observation enrichment
- `/api/progress` - Still needed for progress tracking
- Image normalization - Still needed

---

## 🧪 Testing Strategy

### Test 1: Basic Sequential Naming
```typescript
describe('Simple Sequential Naming', () => {
  it('generates correct sequential names', () => {
    expect(generateSimpleSequentialName('20251024', 1)).toBe('20251024-001.jpg')
    expect(generateSimpleSequentialName('20251024', 10)).toBe('20251024-010.jpg')
    expect(generateSimpleSequentialName('20251024', 100)).toBe('20251024-100.jpg')
  })
  
  it('pads numbers correctly', () => {
    expect(generateSimpleSequentialName('20251024', 1)).toHaveLength(17) // YYYYMMDD-###.jpg
  })
})
```

### Test 2: ZIP Structure
```typescript
it('creates ZIP with simple names', async () => {
  const result = await buildZip({
    observations: mockObservations,
    images: mockImages,
    project: 'GVX04'
  })
  
  // Check photo names
  expect(result.manifest[0].renamedFilename).toBe('20251024-001.jpg')
  expect(result.manifest[1].renamedFilename).toBe('20251024-002.jpg')
  
  // Check manifest structure
  expect(result.manifest[0].originalFilename).toBe('IMG_1234.jpg')
  expect(result.manifest[0].rowNumber).toBe(0)
})
```

### Test 3: End-to-End
1. Upload 10 photos via UI
2. Check downloaded ZIP:
   - ✅ `observations.csv` exists
   - ✅ `photos/20251024-001.jpg` through `20251024-010.jpg` exist
   - ✅ `manifest.json` has correct mappings
   - ✅ No complex naming
   - ✅ No Agent 5 calls in logs

---

## 🔄 Backward Compatibility

### For Existing Code:

**✅ No breaking changes to:**
- API endpoints (same request/response)
- CSV format (unchanged)
- Image processing (unchanged)
- Observation enrichment (unchanged)
- Manifest structure (minor change, but compatible)

**✅ photoNames parameter:**
- Still accepted by `createZipStream()`
- Just ignored (not used for naming)
- Existing code passing `photoNames` won't break

---

## 📊 Performance Impact

| Metric | Before | After | Improvement |
|--------|---------|--------|-------------|
| Naming time (22 photos) | 10-15s | 0ms | **Instant** |
| API calls | 1-2 (Agent 5) | 0 | **-100%** |
| Complexity | High | Low | **Much simpler** |
| Code lines (buildZip) | ~70 lines | ~20 lines | **-71%** |
| User experience | Wait for naming | Immediate | **Better** |

---

## 🚀 Rollout Strategy

### Phase 1: Implement (2-3 hours)
1. Add `generateSimpleSequentialName()` to rename.ts
2. Simplify buildZip.ts photo naming logic
3. Skip Agent 5 in orchestration
4. Update tests

### Phase 2: Test (30 min)
1. Run `npm test` - ensure all pass
2. Test with UI - upload 10-20 photos
3. Verify ZIP contents
4. Check manifest.json

### Phase 3: Deploy
1. Git commit with clear message
2. Deploy to production
3. Monitor for issues

---

## 🔙 Rollback Plan

If issues arise:

### Quick Rollback (5 min):
```bash
git revert <commit-hash>
npm run build
```

### Partial Rollback:
Keep simple naming but re-enable Agent 5 if observations need photo associations

---

## ✅ Success Criteria

After implementation:

1. **Photo naming:**
   - ✅ Format: `YYYYMMDD-###.jpg`
   - ✅ Sequential (001, 002, 003...)
   - ✅ All photos included

2. **Processing speed:**
   - ✅ Faster (no Agent 5 delay)
   - ✅ No AI calls for naming

3. **Output quality:**
   - ✅ observations.csv still generated
   - ✅ manifest.json accurate
   - ✅ ZIP structure clean

4. **Tests:**
   - ✅ All existing tests pass
   - ✅ New tests for simple naming pass

---

## 📝 Questions to Confirm

Before implementing, please confirm:

1. **Date format:** Use upload date (today) or EXIF date from photos?
   - Upload date = consistent across batch
   - EXIF date = might vary per photo

2. **Observations CSV:** Keep generating it? (Recommended: Yes, still valuable)

3. **Manifest:** Keep full structure or simplify? (Recommended: Keep for compatibility)

4. **Agent 1-4:** Keep running them? (Recommended: Yes, for observation enrichment)

5. **Multiple batches same day:** What if user uploads 2 batches on same date?
   - Photos would have overlapping numbers (001, 002...)
   - Solution: Add timestamp? (20251024-1430-001.jpg)

---

## 🎯 Recommendation

**Safest approach:**
1. Use upload date (consistent, simple)
2. Keep observations.csv (valuable)
3. Keep manifest structure (compatible)
4. Skip Agent 5 only (biggest time saver)
5. Keep Agents 1-4 (observation quality)
6. Add HH:MM timestamp if multiple batches per day:
   - `20251024-1430-001.jpg`
   - `20251024-1530-001.jpg`

This gives you:
- ✅ Simple naming
- ✅ All photos included
- ✅ Fast processing
- ✅ No breaking changes
- ✅ Still have valuable observation data

Ready to implement?
