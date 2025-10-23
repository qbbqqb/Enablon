/**
 * Multi-Agent Orchestrator System for Photo Assignment & Enrichment
 *
 * Architecture:
 * 1. PhotoAnalyzer: Extracts metadata from each photo
 * 2. NoteParse: Structures observation notes
 * 3. Matcher (Orchestrator): Intelligently matches photos to notes
 * 4. Validator: Verifies assignments and catches errors
 * 5. Enricher: Creates final enriched observations
 */

import type { ProcessedImage, Observation } from '../types'
import type { ObservationShell } from '../notes/extractShells'
import type { Project } from '../constants/enums'
import {
  CONSTANTS,
  PROJECT_MAPPINGS,
  ROOM_AREAS,
  OBSERVATION_CATEGORIES,
  CATEGORY_TYPES,
  HRA_CATEGORIES,
  GENERAL_CATEGORIES,
  CONSTRUCTION_PHASES,
  SEVERITY_LEVELS
} from '../constants/enums'
import { getStockholmDate } from '../date/stockholm'
import { generateSimplePhotoSlug, slugFromOriginalName } from '../files/rename'

// Photo metadata extracted by Agent 1
interface PhotoMetadata {
  photoId: number
  location: string
  equipment: string[]
  people: string[]
  safetyIssues: string[]
  conditions: string[]
  confidence: 'high' | 'medium' | 'low'
  sentiment: 'problem' | 'good_practice' | 'neutral' // Whether photo shows an issue or good practice
  originalName?: string
}

// Structured note from Agent 2
interface StructuredNote {
  noteId: number
  originalText: string
  location: string
  issueType: string
  keywords: string[]
  requiredElements: string[]
  isPositive: boolean // Whether this is a positive observation
}

// Assignment with reasoning from Agent 3
interface AssignmentWithReasoning {
  noteId: number
  photoIds: number[]
  reasoning: string
  confidence: number
}

// Photo name suggestion from Agent 5
interface PhotoNameSuggestion {
  photoId: number
  suggestedName: string
  reasoning: string
}

// Agent 1: Photo Analyzer
async function analyzePhoto(image: ProcessedImage, index: number): Promise<PhotoMetadata> {
  const apiKey = process.env.OPENROUTER_API_KEY!
  const dataUrl = `data:${image.mimeType};base64,${image.buffer.toString('base64')}`

  const prompt = `Analyze this construction safety photo. Extract factual details AND determine if this shows a PROBLEM or GOOD PRACTICE:

EXTRACT:
1. Location (building area, room, outdoor area)
2. Equipment visible (specific items, brands, IDs)
3. People (count, roles, PPE status)
4. Safety issues (specific hazards)
5. Conditions (weather, lighting, cleanliness)
6. Sentiment: Does this photo show a PROBLEM/HAZARD or a GOOD PRACTICE?
   - "problem" = hazards, violations, damage, poor housekeeping, unsafe conditions
   - "good_practice" = proper PPE, good signage, clean areas, compliant setup
   - "neutral" = general documentation, no clear positive or negative

Return ONLY this JSON format:
{
  "location": "specific location",
  "equipment": ["item1", "item2"],
  "people": ["description1"],
  "safetyIssues": ["issue1", "issue2"],
  "conditions": ["condition1"],
  "confidence": "high|medium|low",
  "sentiment": "problem|good_practice|neutral"
}

Be precise. No speculation. Only what you see.`

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.OPENROUTER_APP_URL || '',
      'X-Title': process.env.OPENROUTER_APP_NAME || 'Enablon Observation Bundler'
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: dataUrl }
        ]
      }],
      temperature: 0.1
    })
  })

  const data = await response.json()
  let content = data.choices[0].message.content.trim()

  // Clean markdown
  if (content.startsWith('```json')) {
    content = content.replace(/^```json\s*/, '').replace(/\s*```$/, '')
  } else if (content.startsWith('```')) {
    content = content.replace(/^```\s*/, '').replace(/\s*```$/, '')
  }

  try {
    const metadata = JSON.parse(content)
    return { photoId: index + 1, originalName: image.originalName, ...metadata }
  } catch (parseError) {
    console.warn(`   ⚠️  Failed to parse photo metadata JSON for photo ${index + 1}, attempting repair...`)
    try {
      const { jsonrepair } = await import('jsonrepair')
      const repaired = jsonrepair(content)
      const metadata = JSON.parse(repaired)
      console.log(`   ✓ Photo ${index + 1} JSON repaired successfully`)
      return { photoId: index + 1, originalName: image.originalName, ...metadata }
    } catch (repairError) {
      console.error(`   ❌ Unable to repair photo metadata for photo ${index + 1}`)
      console.error('      Raw content (first 200 chars):', content.substring(0, 200))
      if (parseError instanceof Error) {
        console.error('      Original parse error:', parseError.message)
      }
      throw repairError
    }
  }
}

// Agent 2: Note Parser
function parseNote(shell: ObservationShell): StructuredNote {
  const text = shell.fullNote.toLowerCase()

  // Detect if this is a positive observation
  const isPositive = text.includes('positive observation') ||
                     text.includes('good practice') ||
                     text.includes('well maintained') ||
                     text.includes('proper signage') ||
                     text.includes('compliant')

  // Extract location (first part before colon or dash)
  const locationMatch = shell.fullNote.match(/^([^:–-]+)[:–-]/)
  const location = locationMatch ? locationMatch[1].trim() : ''

  // Identify issue type
  let issueType = 'other'
  if (text.includes('ppe') || text.includes('protective equipment')) issueType = 'ppe'
  else if (text.includes('barrier') || text.includes('fence')) issueType = 'barriers'
  else if (text.includes('housekeep') || text.includes('storage')) issueType = 'housekeeping'
  else if (text.includes('electrical') || text.includes('cable')) issueType = 'electrical'
  else if (text.includes('scaff') || text.includes('ladder')) issueType = 'working_at_height'
  else if (text.includes('fire') || text.includes('aed') || text.includes('emergency')) issueType = 'emergency'

  // Extract keywords
  const keywords = shell.fullNote
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3)
    .filter(w => !['with', 'from', 'that', 'this', 'were', 'have'].includes(w))

  // Required elements based on issue type
  const requiredElements: string[] = []
  if (issueType === 'ppe') requiredElements.push('person', 'worker')
  if (issueType === 'barriers') requiredElements.push('barrier', 'fence', 'area')
  if (issueType === 'electrical') requiredElements.push('cable', 'wire', 'electrical')

  return {
    noteId: shell.id,
    originalText: shell.fullNote,
    location,
    issueType,
    keywords,
    requiredElements,
    isPositive
  }
}

// Helper: Detect if notes follow a numbered pattern (1, 2, 3...)
function detectNotePattern(
  notes: StructuredNote[],
  photoCount: number
): 'numbered' | 'unnumbered' {
  // DEBUG: Log raw values
  console.log(`   🐛 DEBUG: photoCount=${photoCount}, notes.length=${notes.length}`)

  // SMART DETECTION: If photo count is close to note count, assume sequential workflow
  // This handles the common case: user takes photos in order, writes notes in order
  const ratio = photoCount / notes.length
  console.log(`   🐛 DEBUG: ratio=${ratio} (calculated as ${photoCount}/${notes.length})`)
  console.log(`   🐛 DEBUG: ratio >= 0.8? ${ratio >= 0.8}, ratio <= 1.5? ${ratio <= 1.5}`)

  if (ratio >= 0.8 && ratio <= 1.5) {
    console.log(`   📊 Photo/note ratio: ${ratio.toFixed(2)} - using direct matching workflow`)
    return 'numbered'
  }

  // Check if notes appear to be numbered (1., 2., 3... or "Note 1", "Note 2", etc.)
  let numberedCount = 0

  for (let i = 0; i < Math.min(notes.length, 5); i++) {
    const note = notes[i]
    const text = note.originalText.toLowerCase()

    // Check for patterns like "1.", "1)", "note 1", etc.
    const hasNumberPrefix =
      text.match(/^\s*\d+[\.\)\:]/) ||
      text.match(/^note\s+\d+/i) ||
      text.match(/^\d+\s*-/) ||
      text.match(/^observation\s+\d+/i)

    if (hasNumberPrefix) numberedCount++
  }

  // If most notes (>60%) have number prefixes, consider them numbered
  const threshold = Math.ceil(Math.min(notes.length, 5) * 0.6)
  return numberedCount >= threshold ? 'numbered' : 'unnumbered'
}

function tokensFromText(text: string | undefined): Set<string> {
  const tokens = new Set<string>()
  if (!text) {
    return tokens
  }
  const matches = text.toLowerCase().match(/[a-z0-9]+/g)
  if (!matches) {
    return tokens
  }
  matches.forEach(token => {
    if (token) {
      tokens.add(token)
    }
  })
  return tokens
}

function tokensFromArray(items: string[] | undefined): Set<string> {
  const tokens = new Set<string>()
  if (!Array.isArray(items)) {
    return tokens
  }
  items.forEach(item => {
    tokensFromText(item).forEach(token => tokens.add(token))
  })
  return tokens
}

function mergeTokenSets(...sets: Array<Set<string>>): Set<string> {
  const merged = new Set<string>()
  sets.forEach(set => {
    set.forEach(token => merged.add(token))
  })
  return merged
}

function countIntersection(a: Set<string>, b: Set<string>): number {
  let count = 0
  a.forEach(token => {
    if (b.has(token)) {
      count++
    }
  })
  return count
}

function buildPhotoTokens(photo: PhotoMetadata): Set<string> {
  const locationTokens = tokensFromText(photo.location)
  const safetyTokens = tokensFromArray(photo.safetyIssues)
  const equipmentTokens = tokensFromArray(photo.equipment)
  const peopleTokens = tokensFromArray(photo.people)
  const conditionTokens = tokensFromArray(photo.conditions)
  return mergeTokenSets(locationTokens, safetyTokens, equipmentTokens, peopleTokens, conditionTokens)
}

function buildNoteTokens(note: StructuredNote): Set<string> {
  const locationTokens = tokensFromText(note.location)
  const keywordTokens = new Set(note.keywords.map(k => k.toLowerCase()))
  const descriptionTokens = tokensFromText(note.originalText)
  if (note.issueType) {
    keywordTokens.add(note.issueType.toLowerCase())
  }
  return mergeTokenSets(locationTokens, keywordTokens, descriptionTokens)
}

function computeMatchScore(note: StructuredNote, photo: PhotoMetadata): number {
  if (!matchesSentiment(note, photo) && photo.sentiment !== 'neutral') {
    return Number.NEGATIVE_INFINITY
  }

  const noteTokens = buildNoteTokens(note)
  const photoTokens = buildPhotoTokens(photo)
  const locationOverlap = countIntersection(tokensFromText(note.location), tokensFromText(photo.location))
  const keywordOverlap = countIntersection(noteTokens, photoTokens)

  let score = 0

  if (matchesSentiment(note, photo)) {
    score += 8
  } else if (photo.sentiment === 'neutral') {
    score += 3
  }

  if (locationOverlap > 0) {
    score += locationOverlap * 4
  }

  if (keywordOverlap > 0) {
    score += Math.min(keywordOverlap, 5) * 2.5
  }

  if (note.issueType && photoTokens.has(note.issueType.toLowerCase())) {
    score += 3
  }

  if (note.isPositive && photo.sentiment === 'good_practice') {
    score += 2
  }

  if (!note.isPositive && photo.sentiment === 'problem') {
    score += 2
  }

  if (photo.confidence === 'high') {
    score += 1.5
  } else if (photo.confidence === 'low') {
    score -= 1
  }

  return score
}

function appendReasoning(base: string | undefined, addition: string): string {
  if (!base) {
    return addition
  }
  if (base.includes(addition)) {
    return base
  }
  return `${base} ${addition}`.trim()
}

async function runSentimentBucketMatching(options: {
  bucket: 'positive' | 'problem'
  notes: StructuredNote[]
  photos: PhotoMetadata[]
  apiKey: string
}): Promise<AssignmentWithReasoning[]> {
  const { bucket, notes, photos, apiKey } = options

  if (notes.length === 0) {
    return []
  }

  if (photos.length === 0) {
    return notes.map(note => ({
      noteId: note.noteId,
      photoIds: [],
      reasoning: `No ${bucket === 'positive' ? 'good practice' : 'issue'} photos available for this observation`,
      confidence: 0.2
    }))
  }

  const neutralIncluded = photos.some(photo => photo.sentiment === 'neutral')

  const photoDetails = photos.map(photo => {
    const safetyIssues = Array.isArray(photo.safetyIssues) ? photo.safetyIssues.join(', ') : ''
    const equipment = Array.isArray(photo.equipment) ? photo.equipment.join(', ') : ''
    return `Photo ${photo.photoId}:
  Sentiment: ${photo.sentiment}
  Location: ${photo.location || 'unknown'}
  Safety: ${safetyIssues || 'none'}
  Equipment: ${equipment || 'none'}`
  }).join('\n\n')

  const noteDetails = notes.map(note => {
    const preview = note.originalText.substring(0, 180)
    const sentimentLabel = note.isPositive ? 'POSITIVE' : 'PROBLEM'
    return `Note ${note.noteId} [${sentimentLabel}]:
  Location hint: ${note.location || 'unknown'}
  Issue type: ${note.issueType}
  Keywords: ${note.keywords.slice(0, 10).join(', ') || 'none'}
  Text: ${preview}`
  }).join('\n\n')

  const prompt = `You are matching construction photos to observations.

CONTEXT:
- This dataset only includes ${bucket === 'positive' ? 'positive (good practice)' : 'problem'} notes.
- Photos listed below already respect sentiment (${bucket === 'positive' ? 'good practice' : 'problem'}${neutralIncluded ? ' plus some neutral documentation' : ''}).
- Assign each photo to the BEST matching note. A note may receive multiple photos.
- Use neutral photos only if location/keywords strongly align.
- If you are uncertain, leave the photo unassigned.

PHOTOS:
${photoDetails}

NOTES:
${noteDetails}

MATCHING RULES:
1. Do not mix sentiments.
2. Each photo can appear at most once.
3. Prefer matches with aligned location, issue keywords, or safety topics.
4. Return assignments for the notes you matched. If a note stays unmatched, omit it; we'll handle it later.

Return ONLY JSON in this format:
[
  { "noteId": 12, "photoIds": [3], "reasoning": "Matched by location keywords", "confidence": 0.85 }
]

Be concise but precise.`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 180000)

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      signal: controller.signal,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.OPENROUTER_APP_URL || '',
        'X-Title': process.env.OPENROUTER_APP_NAME || 'Enablon Observation Bundler'
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1
      })
    })

    clearTimeout(timeout)

    if (!response.ok) {
      throw new Error(`Bucket matcher failed with status ${response.status}`)
    }

    const data = await response.json()
    let content = data.choices?.[0]?.message?.content?.trim()

    if (!content) {
      throw new Error('Empty response from bucket matcher')
    }

    if (content.startsWith('```json')) {
      content = content.replace(/^```json\s*/, '').replace(/\s*```$/, '')
    } else if (content.startsWith('```')) {
      content = content.replace(/^```\s*/, '').replace(/\s*```$/, '')
    }

    let assignments: AssignmentWithReasoning[]

    try {
      assignments = JSON.parse(content)
    } catch (parseError) {
      const { jsonrepair } = await import('jsonrepair')
      const repaired = jsonrepair(content)
      assignments = JSON.parse(repaired)
    }

    const validNoteIds = new Set(notes.map(note => note.noteId))

    return assignments
      .filter(assignment => validNoteIds.has(assignment.noteId))
      .map(assignment => ({
        noteId: assignment.noteId,
        photoIds: Array.isArray(assignment.photoIds) ? assignment.photoIds : [],
        reasoning: assignment.reasoning || 'AI bucket matching',
        confidence: typeof assignment.confidence === 'number' ? assignment.confidence : 0.75
      }))
  } catch (error) {
    clearTimeout(timeout)
    console.error(`   ❌ ${bucket === 'positive' ? 'Positive' : 'Problem'} bucket matching failed:`, error)
    return notes.map(note => ({
      noteId: note.noteId,
      photoIds: [],
      reasoning: 'Bucket matching unavailable, needs heuristic assignment',
      confidence: 0.3
    }))
  }
}

function selectBestPhotoForNote(
  note: StructuredNote,
  photoIds: Set<number>,
  photoById: Map<number, PhotoMetadata>
): number | undefined {
  let bestId: number | undefined
  let bestScore = Number.NEGATIVE_INFINITY

  photoIds.forEach(photoId => {
    const photo = photoById.get(photoId)
    if (!photo) {
      return
    }
    if (!matchesSentiment(note, photo) && photo.sentiment !== 'neutral') {
      return
    }
    const score = computeMatchScore(note, photo)
    if (score > bestScore) {
      bestScore = score
      bestId = photoId
    }
  })

  return bestId
}

function applyHeuristicReassignment(
  assignments: AssignmentWithReasoning[],
  photoMetadata: PhotoMetadata[],
  structuredNotes: StructuredNote[]
): AssignmentWithReasoning[] {
  console.log('   🔁 Running deterministic reassignment pass...')

  const noteById = new Map(structuredNotes.map(note => [note.noteId, note]))
  const photoById = new Map(photoMetadata.map(photo => [photo.photoId, photo]))
  const sanitizedAssignments = structuredNotes.map(note => {
    const existing = assignments.find(assignment => assignment.noteId === note.noteId)
    const uniquePhotoIds = new Set<number>(existing?.photoIds || [])
    const filteredPhotoIds = Array.from(uniquePhotoIds).filter(photoId => photoById.has(photoId))
    return {
      noteId: note.noteId,
      photoIds: filteredPhotoIds,
      reasoning: existing?.reasoning || 'Initialized by heuristic pass',
      confidence: existing?.confidence ?? 0.6
    }
  })

  const availablePhotoIds = new Set<number>()
  photoMetadata.forEach(photo => availablePhotoIds.add(photo.photoId))

  sanitizedAssignments.forEach(assignment => {
    const note = noteById.get(assignment.noteId)
    if (!note) {
      return
    }
    assignment.photoIds = assignment.photoIds.filter(photoId => {
      const photo = photoById.get(photoId)
      if (!photo) {
        return false
      }
      if (!matchesSentiment(note, photo) && photo.sentiment !== 'neutral') {
        availablePhotoIds.add(photoId)
        assignment.reasoning = appendReasoning(assignment.reasoning, `Removed photo ${photoId} (sentiment mismatch)`)
        assignment.confidence = Math.min(assignment.confidence, 0.6)
        return false
      }
      return true
    })
  })

  const photoUsage = new Map<number, AssignmentWithReasoning[]>()
  sanitizedAssignments.forEach(assignment => {
    assignment.photoIds.forEach(photoId => {
      if (!photoUsage.has(photoId)) {
        photoUsage.set(photoId, [])
      }
      photoUsage.get(photoId)!.push(assignment)
    })
  })

  photoUsage.forEach((assignmentsUsingPhoto, photoId) => {
    if (assignmentsUsingPhoto.length <= 1) {
      availablePhotoIds.delete(photoId)
      return
    }
    const photo = photoById.get(photoId)
    if (!photo) {
      return
    }
    let keeper = assignmentsUsingPhoto[0]
    let keeperScore = Number.NEGATIVE_INFINITY

    assignmentsUsingPhoto.forEach(assignment => {
      const note = noteById.get(assignment.noteId)
      if (!note) {
        return
      }
      const score = computeMatchScore(note, photo)
      if (score > keeperScore) {
        keeperScore = score
        keeper = assignment
      }
    })

    assignmentsUsingPhoto.forEach(assignment => {
      if (assignment === keeper) {
        availablePhotoIds.delete(photoId)
        return
      }
      assignment.photoIds = assignment.photoIds.filter(id => id !== photoId)
      assignment.reasoning = appendReasoning(assignment.reasoning, `Removed duplicate photo ${photoId}`)
      assignment.confidence = Math.min(assignment.confidence, 0.6)
      availablePhotoIds.add(photoId)
    })
  })

  sanitizedAssignments.forEach(assignment => {
    if (assignment.photoIds.length > 0) {
      return
    }
    const note = noteById.get(assignment.noteId)
    if (!note) {
      return
    }
    const bestPhotoId = selectBestPhotoForNote(note, availablePhotoIds, photoById)
    if (bestPhotoId !== undefined) {
      assignment.photoIds = [bestPhotoId]
      assignment.reasoning = appendReasoning(assignment.reasoning, `Assigned photo ${bestPhotoId} via heuristic match`)
      assignment.confidence = Math.max(assignment.confidence, 0.75)
      availablePhotoIds.delete(bestPhotoId)
    }
  })

  sanitizedAssignments.forEach(assignment => {
    const note = noteById.get(assignment.noteId)
    if (!note) {
      return
    }
    assignment.photoIds = Array.from(new Set(assignment.photoIds))
    assignment.photoIds.sort((a, b) => a - b)

    const score = assignment.photoIds.reduce((total, photoId) => {
      const photo = photoById.get(photoId)
      if (!photo) {
        return total
      }
      const matchScore = computeMatchScore(note, photo)
      return total + Math.max(0, matchScore)
    }, 0)

    if (assignment.photoIds.length > 0 && score > 0) {
      assignment.confidence = Math.min(0.95, Math.max(assignment.confidence, 0.7 + Math.min(score, 12) / 20))
    }
  })

  return sanitizedAssignments
}

// Agent 3: Matcher (Orchestrator)
async function matchPhotosToNotes(
  photoMetadata: PhotoMetadata[],
  structuredNotes: StructuredNote[],
  apiKey: string
): Promise<AssignmentWithReasoning[]> {
  console.log('   Detecting note pattern...')
  const notePattern = detectNotePattern(structuredNotes, photoMetadata.length)
  console.log(`   Note pattern detected: ${notePattern}`)

  const assignmentById = new Map<number, AssignmentWithReasoning>()
  const leftoverPhotoIds = new Set<number>()

  if (notePattern === 'numbered') {
    console.log('   Using DIRECT MATCHING strategy (numbered notes)')
    const pairCount = Math.min(photoMetadata.length, structuredNotes.length)

    for (let i = 0; i < structuredNotes.length; i++) {
      const note = structuredNotes[i]
      const photo = i < pairCount ? photoMetadata[i] : undefined

      if (photo) {
        const sentimentMatch =
          photo.sentiment === 'neutral' ||
          (photo.sentiment === 'problem' && !note.isPositive) ||
          (photo.sentiment === 'good_practice' && note.isPositive)

        if (sentimentMatch) {
          assignmentById.set(note.noteId, {
            noteId: note.noteId,
            photoIds: [photo.photoId],
            reasoning: `Direct numbered match with photo ${photo.photoId}`,
            confidence: 0.92
          })
        } else {
          assignmentById.set(note.noteId, {
            noteId: note.noteId,
            photoIds: [],
            reasoning: `Skipped photo ${photo.photoId} due to sentiment mismatch`,
            confidence: 0.45
          })
          leftoverPhotoIds.add(photo.photoId)
        }
      } else {
        assignmentById.set(note.noteId, {
          noteId: note.noteId,
          photoIds: [],
          reasoning: 'No photo aligned in numbered pass',
          confidence: 0.45
        })
      }
    }

    for (let i = structuredNotes.length; i < photoMetadata.length; i++) {
      leftoverPhotoIds.add(photoMetadata[i].photoId)
    }
  } else {
    console.log('   Using BUCKETED AI MATCHING strategy (unnumbered notes)')
    structuredNotes.forEach(note => {
      assignmentById.set(note.noteId, {
        noteId: note.noteId,
        photoIds: [],
        reasoning: 'Pending bucket match',
        confidence: 0.55
      })
    })
    photoMetadata.forEach(photo => leftoverPhotoIds.add(photo.photoId))
  }

  const notesNeedingMatch = structuredNotes.filter(note => {
    const assignment = assignmentById.get(note.noteId)
    return !assignment || assignment.photoIds.length === 0
  })

  if (notesNeedingMatch.length > 0 && leftoverPhotoIds.size > 0) {
    console.log(`   Bucket matching required for ${notesNeedingMatch.length} notes`)
    const remainingPhotos = photoMetadata.filter(photo => leftoverPhotoIds.has(photo.photoId))

    const problemNotes = notesNeedingMatch.filter(note => !note.isPositive)
    const positiveNotes = notesNeedingMatch.filter(note => note.isPositive)

    const problemPhotos = remainingPhotos.filter(photo => photo.sentiment === 'problem')
    const positivePhotos = remainingPhotos.filter(photo => photo.sentiment === 'good_practice')
    const neutralPhotos = remainingPhotos.filter(photo => photo.sentiment === 'neutral')

    let positiveNeutralCount = 0
    if (neutralPhotos.length > 0) {
      const totalBucketNotes = Math.max(problemNotes.length + positiveNotes.length, 1)
      positiveNeutralCount = Math.round((positiveNotes.length / totalBucketNotes) * neutralPhotos.length)
      positiveNeutralCount = Math.min(positiveNeutralCount, neutralPhotos.length)
      if (positiveNotes.length > 0 && positiveNeutralCount === 0) {
        positiveNeutralCount = 1
      }
    }
    const neutralForPositive = neutralPhotos.slice(0, positiveNeutralCount)
    const neutralForProblem = neutralPhotos.slice(positiveNeutralCount)

    const bucketAssignments: AssignmentWithReasoning[] = []

    if (problemNotes.length > 0 && (problemPhotos.length > 0 || neutralForProblem.length > 0)) {
      const results = await runSentimentBucketMatching({
        bucket: 'problem',
        notes: problemNotes,
        photos: [...problemPhotos, ...neutralForProblem],
        apiKey
      })
      bucketAssignments.push(...results)
    }

    if (positiveNotes.length > 0 && (positivePhotos.length > 0 || neutralForPositive.length > 0)) {
      const results = await runSentimentBucketMatching({
        bucket: 'positive',
        notes: positiveNotes,
        photos: [...positivePhotos, ...neutralForPositive],
        apiKey
      })
      bucketAssignments.push(...results)
    }

    bucketAssignments.forEach(assignment => {
      const existing = assignmentById.get(assignment.noteId)
      if (!existing) {
        assignmentById.set(assignment.noteId, { ...assignment })
      } else {
        const mergedPhotos = new Set<number>([...existing.photoIds, ...assignment.photoIds])
        existing.photoIds = Array.from(mergedPhotos)
        existing.reasoning = appendReasoning(existing.reasoning, assignment.reasoning || 'Bucket reassignment')
        existing.confidence = Math.max(existing.confidence, assignment.confidence)
      }
      assignment.photoIds.forEach(photoId => leftoverPhotoIds.delete(photoId))
    })
  } else {
    console.log('   Bucket matching skipped (no eligible notes or photos)')
  }

  const assignmentList = Array.from(assignmentById.values())
  const refinedAssignments = applyHeuristicReassignment(assignmentList, photoMetadata, structuredNotes)

  console.log(`   ✓ Deterministic pass produced ${refinedAssignments.length} assignments`)

  return refinedAssignments
}

// Agent 3B: Independent Verifier (using smarter model for validation)
async function verifyAndFixAssignments(
  assignments: AssignmentWithReasoning[],
  photoMetadata: PhotoMetadata[],
  structuredNotes: StructuredNote[],
  apiKey: string
): Promise<{ assignments: AssignmentWithReasoning[]; fixed: boolean; reasoning: string }> {
  console.log('🔍 Agent 3B: Independent verification using Gemini 2.5 Flash...')

  // First run basic validation
  const validation = validateAssignments(assignments, photoMetadata.length, structuredNotes.length)

  if (validation.valid && validation.warnings.length === 0) {
    console.log('   ✓ No issues detected, assignments verified')
    return { assignments, fixed: false, reasoning: 'All checks passed' }
  }

  console.log('   ⚠️  Issues detected, requesting AI verification:')
  validation.errors.forEach(e => console.log(`      ERROR: ${e}`))
  validation.warnings.forEach(w => console.log(`      WARNING: ${w}`))

  // Build detailed context for Gemini verifier
  const photoSummaries = photoMetadata.map(p => {
    // Defensive checks for array fields (AI might not always return proper arrays)
    const safetyIssues = Array.isArray(p.safetyIssues) ? p.safetyIssues : []
    const equipment = Array.isArray(p.equipment) ? p.equipment : []
    const people = Array.isArray(p.people) ? p.people : []
    const conditions = Array.isArray(p.conditions) ? p.conditions : []

    return `
Photo ${p.photoId}:
  Location: "${p.location}"
  Sentiment: ${p.sentiment} ${p.sentiment === 'problem' ? '(shows ISSUES/HAZARDS)' : p.sentiment === 'good_practice' ? '(shows GOOD PRACTICES)' : '(neutral documentation)'}
  Safety Issues: ${safetyIssues.length > 0 ? safetyIssues.join(', ') : 'none'}
  Equipment: ${equipment.length > 0 ? equipment.join(', ') : 'none'}
  People: ${people.length > 0 ? people.join(', ') : 'none'}
  Conditions: ${conditions.length > 0 ? conditions.join(', ') : 'none'}
`
  }).join('\n')

  const noteSummaries = structuredNotes.map(n => `
Note ${n.noteId} [${n.isPositive ? 'POSITIVE OBSERVATION' : 'PROBLEM/ISSUE'}]:
  Text: "${n.originalText}"
  Location hint: "${n.location}"
  Issue type: ${n.issueType}
  Keywords: ${n.keywords.slice(0, 8).join(', ')}
`).join('\n')

  const currentAssignments = assignments.map(a =>
    `Note ${a.noteId} ← Photos [${a.photoIds.join(', ')}]`
  ).join('\n')

  const verificationPrompt = `You are an expert reviewer for construction safety photo matching.

TASK: Verify and fix photo-to-observation assignments.

CURRENT ASSIGNMENTS (may have errors):
${currentAssignments}

VALIDATION ERRORS DETECTED:
${validation.errors.length > 0 ? validation.errors.map(e => `- ${e}`).join('\n') : 'None'}

VALIDATION WARNINGS:
${validation.warnings.length > 0 ? validation.warnings.map(w => `- ${w}`).join('\n') : 'None'}

PHOTO DETAILS:
${photoSummaries}

NOTE DETAILS:
${noteSummaries}

CRITICAL MATCHING RULES:
1. **SENTIMENT MUST MATCH**:
   - Photos with sentiment="problem" can ONLY go to notes marked [PROBLEM/ISSUE]
   - Photos with sentiment="good_practice" can ONLY go to notes marked [POSITIVE OBSERVATION]
   - Photos with sentiment="neutral" can go to either
   - NEVER mismatch sentiment!

2. **ONE PHOTO = ONE NOTE**: Each photo must be assigned to exactly ONE note (no duplicates, no orphans)

3. **EVERY NOTE NEEDS PHOTOS**: Each note should have at least one photo

4. **MATCH LOGIC**: First check sentiment, then match by: location > issue type > keywords > equipment

YOUR TASK:
1. Review the current assignments
2. Identify which photos are incorrectly assigned (sentiment mismatch, duplicates, orphans)
3. Create corrected assignments that follow ALL rules
4. Explain what you fixed and why

Return ONLY this JSON format:
{
  "correctedAssignments": [
    {
      "noteId": 1,
      "photoIds": [1, 3],
      "reasoning": "Photos 1 and 3 both show problems in external area, matching this issue note about housekeeping",
      "confidence": 0.95
    }
  ],
  "fixesApplied": "Brief summary of what was wrong and how you fixed it"
}

Think step-by-step. Verify sentiment matching first. Ensure all ${photoMetadata.length} photos are assigned.`

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 180000) // 3 minutes for verification

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      signal: controller.signal,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.OPENROUTER_APP_URL || '',
        'X-Title': process.env.OPENROUTER_APP_NAME || 'Enablon Observation Bundler'
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: verificationPrompt }],
        temperature: 0.1
      })
    })

    clearTimeout(timeout)

    if (!response.ok) {
      console.warn(`   ⚠️  Gemini verification failed: ${response.status}, using original assignments`)
      return { assignments, fixed: false, reasoning: 'Verification service unavailable' }
    }

    const data = await response.json()
    let content = data.choices?.[0]?.message?.content?.trim()

    if (!content) {
      console.warn('   ⚠️  Gemini verification returned empty content, keeping original assignments')
      return { assignments, fixed: false, reasoning: 'Empty verification response' }
    }

    // Extract JSON
    if (content.includes('```json')) {
      content = content.replace(/^[\s\S]*```json\s*/, '').replace(/\s*```[\s\S]*$/, '')
    } else if (content.includes('```')) {
      content = content.replace(/^[\s\S]*```\s*/, '').replace(/\s*```[\s\S]*$/, '')
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      content = jsonMatch[0]
    }

    const result = JSON.parse(content)

    // Validate the corrected assignments
    const newValidation = validateAssignments(
      result.correctedAssignments,
      photoMetadata.length,
      structuredNotes.length
    )

    if (newValidation.valid || newValidation.errors.length < validation.errors.length) {
      console.log('   ✅ Agent 3B fixed assignments:')
      console.log(`      ${result.fixesApplied}`)
      return {
        assignments: result.correctedAssignments,
        fixed: true,
        reasoning: result.fixesApplied
      }
    } else {
      console.warn('   ⚠️  Agent 3B corrections did not improve assignments, using original')
      return { assignments, fixed: false, reasoning: 'Corrections did not improve quality' }
    }

  } catch (error) {
    console.error('   ❌ Agent 3B verification error:', error)
    return { assignments, fixed: false, reasoning: 'Verification failed with error' }
  }
}

// Agent 4: Validator (lightweight checks)
function validateAssignments(
  assignments: AssignmentWithReasoning[],
  photoCount: number,
  noteCount: number
): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []

  // Check all photos assigned
  const assignedPhotos = new Set(assignments.flatMap(a => a.photoIds))
  if (assignedPhotos.size !== photoCount) {
    warnings.push(`Only ${assignedPhotos.size}/${photoCount} photos assigned`)
  }

  // Check for duplicates
  const photoAssignmentCount = new Map<number, number>()
  assignments.forEach(a => {
    a.photoIds.forEach(pid => {
      photoAssignmentCount.set(pid, (photoAssignmentCount.get(pid) || 0) + 1)
    })
  })

  photoAssignmentCount.forEach((count, photoId) => {
    if (count > 1) {
      errors.push(`Photo ${photoId} assigned to ${count} observations (should be 1)`)
    }
  })

  // Check all notes have photos
  if (assignments.length !== noteCount) {
    errors.push(`Assignments cover ${assignments.length}/${noteCount} notes`)
    warnings.push(`${assignments.length} assignments for ${noteCount} notes`)
  }

  assignments.forEach(a => {
    if (a.photoIds.length === 0) {
      warnings.push(`Note ${a.noteId} has no photos assigned`)
    }
    if (a.confidence < 0.7) {
      warnings.push(`Note ${a.noteId} has low confidence (${a.confidence})`)
    }
  })

  return {
    valid: errors.length === 0,
    errors,
    warnings
  }
}

function buildDeterministicSlugContext(options: {
  photoId: number
  metadata: PhotoMetadata
  observation?: ObservationShell
}): {
  slug: string
  locationTokens: Set<string>
  issueTokens: Set<string>
} {
  const { photoId, metadata, observation } = options

  const locationTokens = tokensFromText(metadata.location)
  const noteText = observation?.fullNote || ''
  const noteTokens = tokensFromText(noteText)
  const generatedIssueTokens = tokensFromText(generateSimplePhotoSlug(noteText))
  const safetyTokens = tokensFromArray(metadata.safetyIssues)
  const equipmentTokens = tokensFromArray(metadata.equipment)
  const conditionTokens = tokensFromArray(metadata.conditions)

  const issueTokens = mergeTokenSets(generatedIssueTokens, noteTokens, safetyTokens)
  const objectTokens = mergeTokenSets(equipmentTokens, conditionTokens)

  const slugTokens: string[] = []
  const addToken = (token: string) => {
    const normalized = token.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (!normalized) {
      return
    }
    if (!slugTokens.includes(normalized)) {
      slugTokens.push(normalized)
    }
  }

  Array.from(locationTokens).slice(0, 2).forEach(addToken)
  Array.from(issueTokens).slice(0, 2).forEach(addToken)
  Array.from(objectTokens).slice(0, 1).forEach(addToken)

  const sentimentToken = metadata.sentiment === 'good_practice'
    ? 'good'
    : metadata.sentiment === 'problem'
      ? 'issue'
      : 'neutral'
  addToken(sentimentToken)

  while (slugTokens.length < 3) {
    addToken('site')
  }

  const deterministicSlug = slugTokens.slice(0, 4).join('-') || `photo-${photoId}`

  return {
    slug: deterministicSlug,
    locationTokens,
    issueTokens: mergeTokenSets(issueTokens, objectTokens)
  }
}

function deterministicSlugSuffix(base: string, photoId: number): string {
  const seed = `${base}-${photoId}`
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  const alphabet = 'abcdefghijklmnopqrstuvwxyz'
  const a = alphabet[hash % alphabet.length]
  const b = alphabet[(hash >> 5) % alphabet.length]
  const c = alphabet[(hash >> 10) % alphabet.length]
  const numeric = (photoId * 97 % 100).toString().padStart(2, '0')
  return `${a}${b}${c}${numeric}`
}

function applyNamingGuardrails(options: {
  candidate: string
  deterministic: string
  fallback: string
  locationTokens: Set<string>
  issueTokens: Set<string>
}): string {
  const { candidate, deterministic, fallback, locationTokens, issueTokens } = options
  const cleaned = (candidate || '').replace(/-+/g, '-').replace(/^-|-$/g, '')

  const ensure = (value: string): string => value || deterministic || fallback

  if (!cleaned) {
    return ensure('')
  }

  const tokens = cleaned.split('-').filter(Boolean)
  if (tokens.length < 3) {
    return ensure('')
  }

  const tokenSet = new Set(tokens)
  const hasLocation = locationTokens.size === 0 || Array.from(locationTokens).some(token => tokenSet.has(token))
  const hasIssue = issueTokens.size === 0 || Array.from(issueTokens).some(token => tokenSet.has(token))

  if (!hasLocation || !hasIssue) {
    return ensure('')
  }

  return cleaned
}

// Agent 5: Photo Namer - generates intelligent descriptive names based on assigned observations
async function generatePhotoNamesFromAssignments(
  photoContexts: Array<{
    photoId: number
    metadata: PhotoMetadata
    observation: ObservationShell | undefined
  }>,
  images: ProcessedImage[],
  apiKey: string
): Promise<Record<number, string>> {
  console.log('📝 Agent 5: Generating intelligent photo names based on assigned observations...')
  console.log(`   Input: ${photoContexts.length} photos with observations`)
  console.log('\n   🔍 PHOTO-TO-OBSERVATION ASSIGNMENTS:')
  photoContexts.forEach(ctx => {
    const obsText = ctx.observation?.fullNote || 'NO OBSERVATION ASSIGNED'
    console.log(`   Photo ${ctx.photoId}: "${obsText}"`)
  })
  console.log('')

  const deterministicByPhoto = new Map<number, {
    slug: string
    locationTokens: Set<string>
    issueTokens: Set<string>
  }>()

  const formatList = (items: string[] | undefined): string => {
    if (!Array.isArray(items) || items.length === 0) {
      return 'none'
    }
    return items.join(', ')
  }

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

    return `Photo ${ctx.photoId}:
  Sentiment: ${ctx.metadata.sentiment}
  Observation: "${obsText}"
  Location: ${ctx.metadata.location || 'unknown'}
  Safety issues: ${safety}
  Equipment: ${equipment}
  People: ${people}
  Conditions: ${conditions}
  Deterministic slug: ${deterministic.slug}
  Location tokens: ${locationTokens}
  Issue tokens: ${issueTokens}`
  }).join('\n\n')

  const prompt = `You generate final filenames for construction photos.

For EACH photo, output a SINGLE kebab-case slug with 3-5 tokens capturing:
- Location or area token
- Issue or positive highlight token
- Key object/equipment token
Use the provided deterministic slug as a backbone. You may refine tokens for clarity, but keep them factual.

STRICT RULES:
1. Lowercase letters/numbers only, separated by hyphens.
2. At least 3 tokens, maximum 5.
3. Include one token from the location tokens list when possible.
4. Include one token from the issue tokens list when possible.
5. Avoid generic results like "photo", "positive-observation", "site" alone.
6. Do not invent locations or issues not present in the context.

PHOTO CONTEXTS:
${contextBlocks}

Return ONLY JSON:
[
  {"photoId": 3, "suggestedName": "colo3-trip-hazard-cable", "reasoning": "Uses location, issue, object tokens"}
]`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 180000)

  let suggestions: PhotoNameSuggestion[]

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      signal: controller.signal,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.OPENROUTER_APP_URL || '',
        'X-Title': process.env.OPENROUTER_APP_NAME || 'Enablon Observation Bundler'
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2
      })
    })

    clearTimeout(timeout)

    if (!response.ok) {
      throw new Error(`Gemini naming request failed: ${response.status}`)
    }

    const data = await response.json()
    let content = data.choices?.[0]?.message?.content?.trim()

    if (!content) {
      throw new Error('Empty naming response from Gemini')
    }

    if (content.startsWith('```json')) {
      content = content.replace(/^```json\s*/, '').replace(/\s*```$/, '')
    } else if (content.startsWith('```')) {
      content = content.replace(/^```\s*/, '').replace(/\s*```$/, '')
    }

    try {
      suggestions = JSON.parse(content)
    } catch (parseError) {
      const { jsonrepair } = await import('jsonrepair')
      const repaired = jsonrepair(content)
      suggestions = JSON.parse(repaired)
    }
  } catch (error) {
    clearTimeout(timeout)
    console.error('❌ Failed to generate photo names:', error)
    return {}
  }

  console.log(`
✅ Generated ${suggestions.length} photo name suggestions
`)

  const genericNames = new Set([
    'positive-observation',
    'problem-photo',
    'observation',
    'photo',
    'construction-site',
    'site-photo',
    'site-observation',
    'good-practice',
    'issue'
  ])

  const issuesByPhoto = new Map<number, { name: string; reasons: string[] }>()

  suggestions.forEach(suggestion => {
    const normalized = suggestion.suggestedName.toLowerCase()
    const tokens = normalized.split('-').filter(Boolean)

    const entry = issuesByPhoto.get(suggestion.photoId) ?? { name: suggestion.suggestedName, reasons: [] }

    if (tokens.length < 3) {
      entry.reasons.push('Needs at least three tokens (location, issue, object)')
    }

    if (genericNames.has(normalized)) {
      entry.reasons.push('Name is too generic')
    }

    const deterministic = deterministicByPhoto.get(suggestion.photoId)
    if (deterministic) {
      const tokenSet = new Set(tokens)
      const hasLocation = deterministic.locationTokens.size === 0 || Array.from(deterministic.locationTokens).some(token => tokenSet.has(token))
      const hasIssue = deterministic.issueTokens.size === 0 || Array.from(deterministic.issueTokens).some(token => tokenSet.has(token))

      if (!hasLocation) {
        entry.reasons.push('Missing any location token from the provided list')
      }
      if (!hasIssue) {
        entry.reasons.push('Missing any issue token from the provided list')
      }
    }

    if (entry.reasons.length > 0) {
      issuesByPhoto.set(suggestion.photoId, entry)
    }
  })

  const problematic = Array.from(issuesByPhoto.entries())
  if (problematic.length > 0) {
    console.warn(`
⚠️  Naming validation detected ${problematic.length} items to fix`)

    const retryPrompt = `Some of your filenames missed required constraints. Rewrite ONLY the problematic entries below.
Each output MUST follow:
- 3-5 tokens in kebab-case
- Include at least one provided location token
- Include at least one provided issue token
- Keep details factual

${problematic.map(([photoId, info]) => {
  const deterministic = deterministicByPhoto.get(photoId)!
  const locationTokens = Array.from(deterministic.locationTokens).join(', ') || 'none'
  const issueTokens = Array.from(deterministic.issueTokens).join(', ') || 'none'
  const reasons = info.reasons.map(r => `    - ${r}`).join('\n')
  return `Photo ${photoId}:
  Previous name: "${info.name}"
  Deterministic slug: ${deterministic.slug}
  Location tokens: ${locationTokens}
  Issue tokens: ${issueTokens}
  Problems:
${reasons}`
}).join('\n\n')}

Return ONLY JSON array of fixes: [{"photoId": 4, "suggestedName": "...", "reasoning": "..."}]`

    try {
      const retryResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.OPENROUTER_APP_URL || '',
          'X-Title': process.env.OPENROUTER_APP_NAME || 'Enablon Observation Bundler'
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [{ role: 'user', content: retryPrompt }],
          temperature: 0.2
        })
      })

      if (retryResponse.ok) {
        const retryData = await retryResponse.json()
        let retryContent = retryData.choices?.[0]?.message?.content?.trim()

        if (retryContent) {
          if (retryContent.startsWith('```json')) {
            retryContent = retryContent.replace(/^```json\s*/, '').replace(/\s*```$/, '')
          } else if (retryContent.startsWith('```')) {
            retryContent = retryContent.replace(/^```\s*/, '').replace(/\s*```$/, '')
          }

          try {
            const improved: PhotoNameSuggestion[] = JSON.parse(retryContent)
            improved.forEach(update => {
              const index = suggestions.findIndex(s => s.photoId === update.photoId)
              if (index !== -1) {
                suggestions[index] = update
                console.log(`   ✓ Updated Photo ${update.photoId}: "${update.suggestedName}"`)
              }
            })
          } catch (retryParseError) {
            console.warn('Retry response parse failed:', retryParseError)
          }
        }
      }
    } catch (retryError) {
      console.error('⚠️  Naming retry failed:', retryError)
    }
  }

  console.log('\n   📋 FINAL GENERATED NAMES:')
  suggestions.forEach(s => {
    const ctx = photoContexts.find(c => c.photoId === s.photoId)
    const obsText = ctx?.observation?.fullNote || 'No observation'
    console.log(`   Photo ${s.photoId}: "${s.suggestedName}"`)
    console.log(`      Observation: "${obsText.substring(0, 100)}..."`)
    console.log(`      AI Reasoning: ${s.reasoning}`)
  })
  console.log('')

  const photoNames: Record<number, string> = {}
  const lightweightImages: ProcessedImage[] = photoContexts.map(ctx => {
    const sourceImage = images[ctx.photoId - 1]
    if (sourceImage) {
      return sourceImage
    }
    return {
      originalIndex: ctx.photoId - 1,
      originalName: ctx.metadata.originalName || `photo-${ctx.photoId}.jpg`,
      buffer: Buffer.alloc(0),
      mimeType: 'image/jpeg'
    }
  })

  const observationDrafts = photoContexts.map(ctx => ({
    'Observation Description': ctx.observation?.fullNote || '',
    'General Category': '',
    'High Risk + Significant Exposure': '',
    'Room/Area': ctx.metadata.location || ''
  }))

  const sanitizedSuggestions = suggestions.map(s => ({
    photoId: s.photoId,
    suggestedName: s.suggestedName
  }))

  return sanitizeAndAssignPhotoNames({
    images: lightweightImages,
    observations: observationDrafts,
    suggestions: sanitizedSuggestions,
    deterministicMap: deterministicByPhoto
  })
}
// Standalone photo namer - works without orchestrator
export async function generateSimplePhotoNames(
  images: ProcessedImage[],
  observations: any[]
): Promise<Record<number, string>> {
  console.log('📝 Generating simple photo names...')

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.warn('No API key available for photo naming')
    return {}
  }

  // Build simple context: each photo with its observation description
  const photoContexts = images.map((img, idx) => {
    const obs = observations[idx]
    return {
      photoId: idx + 1,
      description: obs?.['Observation Description'] || 'Unknown',
      category: obs?.['General Category'] || obs?.['High Risk + Significant Exposure'] || 'Unknown',
      location: obs?.['Room/Area'] || 'Unknown'
    }
  })

  const prompt = `You are a photo naming expert for construction safety observations.

PHOTO CONTEXTS:
${photoContexts.map(ctx => `
Photo ${ctx.photoId}:
  - Observation: ${ctx.description.substring(0, 100)}
  - Category: ${ctx.category}
  - Location: ${ctx.location}
`).join('\n')}

TASK: Generate short, descriptive filenames for each photo based on the observation.

RULES:
1. Name should describe the main safety issue or topic
2. Keep it short: 2-4 words maximum
3. Use kebab-case (lowercase with hyphens)
4. Be specific and descriptive
5. Do not include photo numbers or dates

EXAMPLES:
- "damaged-electrical-cable"
- "blocked-fire-exit"
- "missing-hard-hat"
- "good-housekeeping"
- "ppe-compliance"
- "scaffolding-setup"

Return ONLY this JSON format:
[
  {
    "photoId": 1,
    "suggestedName": "damaged-cable-tray"
  },
  {
    "photoId": 2,
    "suggestedName": "blocked-exit"
  }
]

Be concise. Focus on what matters.`

  try {
    console.log(`Requesting AI photo names for ${images.length} photos...`)
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.OPENROUTER_APP_URL || '',
        'X-Title': process.env.OPENROUTER_APP_NAME || 'Enablon Observation Bundler'
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3
      })
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      console.error('Failed to generate photo names:', response.status, response.statusText, errorText)
      return {}
    }

    const data = await response.json()

    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      console.error('Invalid AI response structure for photo naming:', JSON.stringify(data))
      return {}
    }

    let content = data.choices[0].message.content?.trim()

    if (!content) {
      console.error('Empty content from AI for photo naming')
      return {}
    }

    console.log('Raw AI response for photo naming (first 500 chars):', content.substring(0, 500))

    if (content.startsWith('```json')) {
      content = content.replace(/^```json\s*/, '').replace(/\s*```$/, '')
    } else if (content.startsWith('```')) {
      content = content.replace(/^```\s*/, '').replace(/\s*```$/, '')
    }
    let rawSuggestions: unknown

    try {
      rawSuggestions = JSON.parse(content)
    } catch (parseError) {
      console.warn('Failed to parse AI photo names JSON, attempting repair...')
      try {
        const { jsonrepair } = await import('jsonrepair')
        const repaired = jsonrepair(content)
        rawSuggestions = JSON.parse(repaired)
      } catch (repairError) {
        console.error('❌ Unable to repair AI photo naming response:', repairError)
        if (parseError instanceof Error) {
          console.error('Original parse error:', parseError.message)
        }
        return {}
      }
    }

    if (!Array.isArray(rawSuggestions) || rawSuggestions.length === 0) {
      console.warn('AI returned empty or invalid photo name suggestions')
      return {}
    }

    const suggestions = rawSuggestions as Array<{ photoId: number; suggestedName: string }>

    // Log suggestions
    console.log(`✅ Generated ${suggestions.length} photo names`)
    suggestions.slice(0, 5).forEach(s => {
      console.log(`   Photo ${s.photoId}: "${s.suggestedName}"`)
    })
    if (suggestions.length > 5) {
      console.log(`   ... and ${suggestions.length - 5} more`)
    }

    const sanitizedNames = sanitizeAndAssignPhotoNames({ images, observations, suggestions })

    console.log(`Returning ${Object.keys(sanitizedNames).length} photo names`)
    return sanitizedNames
  } catch (error) {
    console.error('❌ Error generating photo names:', error)
    if (error instanceof Error) {
      console.error('Error stack:', error.stack)
    }
    return {}
  }
}

function sanitizeAndAssignPhotoNames(options: {
  images: ProcessedImage[]
  observations: any[]
  suggestions: Array<{ photoId: number; suggestedName: string }>
  deterministicMap?: Map<number, { slug: string; locationTokens: Set<string>; issueTokens: Set<string> }>
}): Record<number, string> {
  const { images, observations, suggestions, deterministicMap } = options

  const suggestionMap = new Map<number, string>()
  const usedSlugs = new Set<string>()
  const photoNames: Record<number, string> = {}

  suggestions.forEach(suggestion => {
    const photoId = Number(suggestion.photoId)
    if (!Number.isInteger(photoId) || photoId < 1 || photoId > images.length) {
      return
    }

    const sanitized = sanitizeSuggestedSlug(suggestion.suggestedName)
    if (sanitized) {
      suggestionMap.set(photoId, sanitized)
    }
  })

  images.forEach((image, index) => {
    const photoId = index + 1
    const observation = observations[index]

    const deterministic = deterministicMap?.get(photoId)
    const deterministicSlug = deterministic?.slug ? sanitizeSuggestedSlug(deterministic.slug) : ''
    const locationTokens = deterministic?.locationTokens ?? new Set<string>()
    const issueTokens = deterministic?.issueTokens ?? new Set<string>()

    const observationDescription = typeof observation?.['Observation Description'] === 'string'
      ? observation['Observation Description']
      : ''

    const fallbackFromObservation = observationDescription
      ? generateSimplePhotoSlug(observationDescription)
      : ''

    const fallbackCandidates = [
      deterministicSlug,
      sanitizeSuggestedSlug(fallbackFromObservation),
      sanitizeSuggestedSlug(observationDescription),
      sanitizeSuggestedSlug(slugFromOriginalName(image.originalName)),
      sanitizeSuggestedSlug(`photo-${photoId}`)
    ].filter(Boolean)

    let fallbackSlug = fallbackCandidates.find(slug => wordCount(slug) >= 3)
      || fallbackCandidates.find(slug => wordCount(slug) >= 2)
      || fallbackCandidates[0]
      || `photo-${photoId}`

    if (wordCount(fallbackSlug) < 3) {
      fallbackSlug = sanitizeSuggestedSlug(`photo-${photoId}`) || `photo-${photoId}`
    }

    const preferredSlug = suggestionMap.get(photoId)
    const candidateInput = preferredSlug || deterministicSlug || fallbackSlug

    const guardedSlug = applyNamingGuardrails({
      candidate: candidateInput,
      deterministic: deterministicSlug || fallbackSlug,
      fallback: fallbackSlug,
      locationTokens,
      issueTokens
    })

    const finalSlug = dedupeSlug(
      guardedSlug,
      usedSlugs,
      fallbackCandidates,
      photoId,
      deterministic ? deterministicSlugSuffix(deterministic.slug, photoId) : undefined
    )

    photoNames[photoId] = finalSlug
  })

  return photoNames
}

function sanitizeSuggestedSlug(raw: string | undefined): string {
  if (!raw) {
    return ''
  }

  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) {
    return ''
  }

  const tokens = normalized.split(' ').filter(Boolean)
  if (tokens.length === 0) {
    return ''
  }

  const limited = tokens.slice(0, 4) // Keep names short
  let slug = limited.join('-').replace(/-+/g, '-')
  slug = slug.replace(/^-|-$/g, '')

  if (slug.length > 60) {
    slug = slug.slice(0, 60).replace(/-+$/, '')
  }

  return slug
}

function dedupeSlug(
  base: string,
  used: Set<string>,
  extras: string[],
  photoId: number,
  deterministicSuffix?: string
): string {
  const limitedBase = limitSlug(base)

  if (!used.has(limitedBase)) {
    used.add(limitedBase)
    return limitedBase
  }

  const baseTokens = new Set(limitedBase.split('-').filter(Boolean))
  const extraTokens: string[] = []

  extras.forEach(extra => {
    extra
      .split('-')
      .map(token => token.trim())
      .filter(Boolean)
      .forEach(token => {
        if (baseTokens.has(token)) {
          return
        }
        if (!extraTokens.includes(token)) {
          extraTokens.push(token)
        }
      })
  })

  for (const token of extraTokens) {
    const attempt = limitSlug(`${limitedBase}-${token}`)
    if (!used.has(attempt)) {
      used.add(attempt)
      return attempt
    }
  }

  if (deterministicSuffix) {
    const attempt = limitSlug(`${limitedBase}-${deterministicSuffix}`)
    if (!used.has(attempt)) {
      used.add(attempt)
      return attempt
    }
  }

  // Final fallback: numeric suffix
  let counter = 2
  while (counter < 100) {
    const attempt = limitSlug(`${limitedBase}-${counter}`)
    if (!used.has(attempt)) {
      used.add(attempt)
      return attempt
    }
    counter++
  }

  const emergency = limitSlug(`${limitedBase}-photo-${photoId}`)
  used.add(emergency)
  return emergency
}

function wordCount(slug: string): number {
  return slug.split('-').filter(Boolean).length
}

function limitSlug(slug: string, maxLength = 60): string {
  if (slug.length <= maxLength) {
    return slug
  }
  return slug.slice(0, maxLength).replace(/-+$/, '')
}

// Main Orchestrator
export async function orchestratePhotoAssignment(
  images: ProcessedImage[],
  observationShells: ObservationShell[]
): Promise<{ assignments: Record<number, number[]>; metadata: any }> {
  console.log('🎭 Starting Multi-Agent Orchestration')
  console.log(`   Images: ${images.length}, Observations: ${observationShells.length}`)

  const apiKey = process.env.OPENROUTER_API_KEY!

  // Step 1: Analyze all photos in parallel
  console.log('🔍 Agent 1: Analyzing photos...')
  const photoMetadata = await Promise.all(
    images.map((img, idx) => analyzePhoto(img, idx))
  )
  console.log(`   ✓ Analyzed ${photoMetadata.length} photos`)

  // Log sentiment analysis (first 5 photos)
  console.log('   Sentiment analysis:')
  photoMetadata.slice(0, 5).forEach(p => {
    console.log(`      Photo ${p.photoId}: ${p.sentiment} (${p.safetyIssues.length} issues found)`)
  })
  if (photoMetadata.length > 5) {
    console.log(`      ... and ${photoMetadata.length - 5} more photos`)
  }

  // Step 2: Parse all notes
  console.log('📝 Agent 2: Parsing notes...')
  const structuredNotes = observationShells.map(parseNote)
  console.log(`   ✓ Parsed ${structuredNotes.length} notes`)

  // Log positive vs problem notes
  const positiveNotes = structuredNotes.filter(n => n.isPositive).length
  const problemNotes = structuredNotes.length - positiveNotes
  console.log(`      ${positiveNotes} positive observations, ${problemNotes} problem observations`)

  // Step 3: Orchestrator matches
  console.log('🎯 Agent 3: Matching photos to notes...')
  let assignmentsWithReasoning = await matchPhotosToNotes(photoMetadata, structuredNotes, apiKey)
  console.log(`   ✓ Created ${assignmentsWithReasoning.length} assignments`)

  // Log reasoning
  assignmentsWithReasoning.forEach(a => {
    console.log(`   Note ${a.noteId} → Photos [${a.photoIds.join(',')}] (confidence: ${a.confidence})`)
    console.log(`      Reasoning: ${a.reasoning}`)
  })

  let validation = validateAssignments(assignmentsWithReasoning, images.length, observationShells.length)

  if (!validation.valid || validation.warnings.length > 0) {
    // Step 3B: Independent verification (uses Gemini 2.5 Flash for reasoning)
    console.log('🔍 Step 3B: Independent verification...')
    const verificationResult = await verifyAndFixAssignments(
      assignmentsWithReasoning,
      photoMetadata,
      structuredNotes,
      apiKey
    )

    if (verificationResult.fixed) {
      console.log(`   ✅ Agent 3B corrected assignments: ${verificationResult.reasoning}`)
      assignmentsWithReasoning = verificationResult.assignments
      validation = validateAssignments(assignmentsWithReasoning, images.length, observationShells.length)
    }
  } else {
    console.log('🔍 Step 3B: Skipped (assignments already consistent)')
  }

  // Step 4: Final validation
  console.log('✅ Agent 4: Final validation...')

  // If validation still fails after Agent 3B, apply fallback strategy (last resort)
  if (!validation.valid) {
    console.warn('⚠️  Validation issues detected, applying fallback strategy:')
    validation.errors.forEach(e => console.warn(`   - ${e}`))

    // Fallback: Fix missing assignments, duplicates, and orphaned photos
    const noteById = new Map(structuredNotes.map(note => [note.noteId, note]))

    const orphanedPhotosSet = new Set<number>()

    const assignmentBuckets = new Map<number, AssignmentWithReasoning[]>()
    assignmentsWithReasoning.forEach(assignment => {
      assignment.photoIds.forEach(pid => {
        if (!assignmentBuckets.has(pid)) {
          assignmentBuckets.set(pid, [])
        }
        assignmentBuckets.get(pid)!.push(assignment)
      })
    })

    assignmentBuckets.forEach((list, photoId) => {
      if (list.length <= 1) {
        return
      }

      const photo = photoMetadata.find(p => p.photoId === photoId)
      let keeper = list[0]
      if (photo) {
        const sentimentMatch = list.find(assignment => {
          const note = noteById.get(assignment.noteId)
          return matchesSentiment(note, photo)
        })
        if (sentimentMatch) {
          keeper = sentimentMatch
        } else {
          keeper = list.reduce((best, current) =>
            current.confidence > best.confidence ? current : best
          )
        }
      }

      list.forEach(assignment => {
        if (assignment === keeper) {
          return
        }
        assignment.photoIds = assignment.photoIds.filter(id => id !== photoId)
        assignment.reasoning += ` (Fallback: Removed duplicate photo ${photoId})`
        assignment.confidence = Math.min(assignment.confidence, 0.6)
        orphanedPhotosSet.add(photoId)
      })
    })

    const assignedPhotos = new Set<number>()
    assignmentsWithReasoning.forEach(a => {
      a.photoIds.forEach(pid => assignedPhotos.add(pid))
    })

    for (let i = 1; i <= images.length; i++) {
      if (!assignedPhotos.has(i)) {
        orphanedPhotosSet.add(i)
      }
    }

    const orphanedPhotos = Array.from(orphanedPhotosSet)

    // Find notes without photos
    const notesWithoutPhotos = assignmentsWithReasoning
      .filter(a => a.photoIds.length === 0)
      .map(a => a.noteId)

    if (orphanedPhotos.length > 0 && notesWithoutPhotos.length > 0) {
      console.log('🔧 Fallback: Assigning orphaned photos to notes without photos')

      // Distribute orphaned photos to notes that need them
      let photoIndex = 0
      for (const noteId of notesWithoutPhotos) {
        if (photoIndex < orphanedPhotos.length) {
          const assignment = assignmentsWithReasoning.find(a => a.noteId === noteId)
          if (assignment) {
            assignment.photoIds = [orphanedPhotos[photoIndex]]
            assignment.reasoning += ` (Fallback: Assigned orphaned photo ${orphanedPhotos[photoIndex]})`
            assignment.confidence = 0.5
            console.log(`   Note ${noteId} ← Photo ${orphanedPhotos[photoIndex]} (fallback)`)
            photoIndex++
          }
        }
      }

      // If there are still orphaned photos, assign them to the last note
      if (photoIndex < orphanedPhotos.length && assignmentsWithReasoning.length > 0) {
        const lastAssignment = assignmentsWithReasoning[assignmentsWithReasoning.length - 1]
        const remainingPhotos = orphanedPhotos.slice(photoIndex)
        lastAssignment.photoIds.push(...remainingPhotos)
        lastAssignment.reasoning += ` (Fallback: Added ${remainingPhotos.length} remaining orphaned photos)`
        console.log(`   Note ${lastAssignment.noteId} ← Photos [${remainingPhotos.join(', ')}] (fallback)`)
      }
    } else if (orphanedPhotos.length > 0) {
      // No notes without photos, add orphaned photos to existing assignments respecting sentiment
      console.log('🔧 Fallback: Distributing orphaned photos to existing assignments')
      orphanedPhotos.forEach(photoId => {
        const photo = photoMetadata.find(p => p.photoId === photoId)
        let target: AssignmentWithReasoning | undefined
        if (photo) {
          const preferred = assignmentsWithReasoning.find(a => {
            const note = noteById.get(a.noteId)
            return matchesSentiment(note, photo)
          })
          target = preferred || assignmentsWithReasoning[0]
        } else {
          target = assignmentsWithReasoning[0]
        }

        target.photoIds.push(photoId)
        target.reasoning += ` (Fallback: Added orphaned photo ${photoId})`
        target.confidence = Math.min(target.confidence, 0.6)
        console.log(`   Note ${target.noteId} ← Photo ${photoId} (fallback)`)
      })
    } else if (notesWithoutPhotos.length > 0) {
      // No orphaned photos, assign the first photo to notes without photos
      console.log('🔧 Fallback: Assigning first photo to notes without photos')
      notesWithoutPhotos.forEach(noteId => {
        const assignment = assignmentsWithReasoning.find(a => a.noteId === noteId)
        if (assignment) {
          assignment.photoIds = [1]
          assignment.reasoning += ` (Fallback: Assigned first photo as placeholder)`
          assignment.confidence = 0.3
          console.log(`   Note ${noteId} ← Photo 1 (fallback placeholder)`)
        }
      })
    }

    console.log('✅ Fallback strategy applied, continuing with processing')
  }

  if (validation.warnings.length > 0) {
    console.warn('⚠️  Validation warnings:')
    validation.warnings.forEach(w => console.warn(`   - ${w}`))
  }

  console.log('   ✓ Validation passed')

  // Convert to Record format
  const assignments: Record<number, number[]> = {}
  assignmentsWithReasoning.forEach(a => {
    assignments[a.noteId] = a.photoIds
  })

  // Step 5: Generate intelligent photo names based on assignments
  // Create a mapping of photoId to its assigned observation
  const photoToObservationMap: Record<number, ObservationShell> = {}
  for (const [noteId, photoIds] of Object.entries(assignments)) {
    const shell = observationShells.find(s => s.id === parseInt(noteId))
    if (shell) {
      photoIds.forEach(photoId => {
        photoToObservationMap[photoId] = shell
      })
    }
  }

  // Build enriched contexts for naming
  const enrichedPhotoContexts = photoMetadata.map(photo => {
    const assignedObservation = photoToObservationMap[photo.photoId]
    return {
      photoId: photo.photoId,
      metadata: photo,
      observation: assignedObservation
    }
  })

  const photoNames = await generatePhotoNamesFromAssignments(enrichedPhotoContexts, images, apiKey)
  console.log(`   ✓ Generated ${Object.keys(photoNames).length} photo names`)

  console.log('🎭 Orchestration complete!')

  return {
    assignments,
    metadata: {
      photoMetadata,
      structuredNotes,
      assignmentsWithReasoning,
      validation,
      photoNames
    }
  }
}

function matchesSentiment(note: StructuredNote | undefined, photo: PhotoMetadata | undefined): boolean {
  if (!note || !photo) {
    return false
  }
  if (photo.sentiment === 'neutral') {
    return true
  }
  if (note.isPositive) {
    return photo.sentiment === 'good_practice'
  }
  return photo.sentiment === 'problem'
}
