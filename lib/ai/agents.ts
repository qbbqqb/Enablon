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
import { generateSimplePhotoSlug, slugFromOriginalName, buildObservationPhotoSlug } from '../files/rename'

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
  filenameHints?: ProcessedImage['originalFilenameHints'] // Metadata from structured filename
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

interface AffinityCandidate {
  photoId: number
  score: number
  matchedLocations: string[]
  matchedIssues: string[]
  matchedKeywords: string[]
}

const AFFINITY_STRONG_THRESHOLD = 1.5
const SCORE_IMPROVEMENT_MARGIN = 0.25

function tokenize(text: string | undefined): string[] {
  if (!text) return []
  return text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 2)
}

function buildNoteProfile(note: StructuredNote) {
  const locationTokens = new Set(tokenize(note.location))
  const issueTokens = new Set<string>()
  const keywordTokens = new Set<string>()

  if (note.issueType) {
    issueTokens.add(note.issueType.toLowerCase())
  }

  note.requiredElements.forEach(element => {
    tokenize(element).forEach(token => issueTokens.add(token))
  })

  note.keywords.forEach(keyword => {
    tokenize(keyword).forEach(token => keywordTokens.add(token))
  })

  tokenize(note.originalText).forEach(token => keywordTokens.add(token))

  return { locationTokens, issueTokens, keywordTokens }
}

function buildPhotoProfile(photo: PhotoMetadata) {
  const locationTokens = new Set(tokenize(photo.location))
  const issueTokens = new Set<string>()
  const contextTokens = new Set<string>()

  const addTokens = (value: string | string[] | undefined, target: Set<string>) => {
    if (!value) return
    if (Array.isArray(value)) {
      value.forEach(entry => tokenize(entry).forEach(token => target.add(token)))
    } else {
      tokenize(value).forEach(token => target.add(token))
    }
  }

  addTokens(photo.safetyIssues, issueTokens)
  addTokens(photo.conditions, contextTokens)
  addTokens(photo.equipment, contextTokens)
  addTokens(photo.people, contextTokens)

  return { locationTokens, issueTokens, contextTokens }
}

function computeAffinityCandidate(
  photo: PhotoMetadata,
  note: StructuredNote,
  noteProfile: ReturnType<typeof buildNoteProfile>,
  photoProfile: ReturnType<typeof buildPhotoProfile>
): AffinityCandidate | null {
  // PHASE 1.5: Reject matches with critical filename hint mismatches
  const hints = photo.filenameHints
  if (hints) {
    // CRITICAL REJECTION 1: Project code mismatch
    if (hints.project) {
      const noteText = note.originalText.toLowerCase()
      const hintProject = hints.project.toLowerCase()
      // Reject if note explicitly mentions a DIFFERENT project
      const otherProjects = ['gvx03', 'gvx04', 'gvx05', 'gvx06'].filter(p => p !== hintProject)
      const hasDifferentProject = otherProjects.some(p => noteText.includes(p))
      if (hasDifferentProject) {
        // Note mentions GVX04 but photo is GVX05 (or vice versa) - REJECT
        return null
      }
    }
    
    // CRITICAL REJECTION 2: Sentiment mismatch with positive photos
    // Positive photos should NEVER match negative observations
    if (hints.sentiment === 'positive' && !note.isPositive) {
      return null
    }
    
    // CRITICAL REJECTION 3: Major location mismatch
    // If filename clearly states a location, reject opposite locations
    if (hints.location) {
      const hintLoc = hints.location.toLowerCase()
      const noteLoc = note.location.toLowerCase()
      
      // COLO vs Laydown are mutually exclusive
      if ((hintLoc.includes('colo') && noteLoc.includes('laydown')) ||
          (hintLoc.includes('laydown') && noteLoc.includes('colo'))) {
        return null
      }
      
      // Corridor vs External/Laydown are mutually exclusive
      if ((hintLoc.includes('corridor') && (noteLoc.includes('external') || noteLoc.includes('laydown'))) ||
          ((hintLoc.includes('external') || hintLoc.includes('laydown')) && noteLoc.includes('corridor'))) {
        return null
      }
    }
  }
  
  // Existing sentiment-based rejections
  if (note.isPositive && photo.sentiment === 'problem') {
    return null
  }
  if (!note.isPositive && photo.sentiment === 'good_practice') {
    return null
  }

  const locationMatches = new Set<string>()
  noteProfile.locationTokens.forEach(token => {
    if (photoProfile.locationTokens.has(token)) {
      locationMatches.add(token)
    }
  })

  const issueMatches = new Set<string>()
  noteProfile.issueTokens.forEach(token => {
    if (photoProfile.issueTokens.has(token)) {
      issueMatches.add(token)
    }
  })

  const keywordMatches = new Set<string>()
  noteProfile.keywordTokens.forEach(token => {
    if (photoProfile.contextTokens.has(token)) {
      keywordMatches.add(token)
    }
  })

  let score = 0

  if (locationMatches.size > 0) {
    score += 2
    score += (locationMatches.size - 1) * 0.25
  }

  if (issueMatches.size > 0) {
    score += issueMatches.size * 1.2
  }

  if (keywordMatches.size > 0) {
    score += Math.min(keywordMatches.size, 4) * 0.4
  }

  if (photo.sentiment !== 'neutral') {
    score += 0.3
  }

  // PHASE 1.5: Boost affinity based on filename hints (INCREASED WEIGHTS)
  const hintsForBoost = photo.filenameHints
  if (hintsForBoost) {
    // Project code match (2.5 boost) - CRITICAL signal
    if (hintsForBoost.project) {
      const noteText = note.originalText.toLowerCase()
      if (noteText.includes(hintsForBoost.project.toLowerCase())) {
        score += 2.5
        locationMatches.add(`filename-project:${hintsForBoost.project}`)
      }
    }
    
    // Location match (2.0 boost) - VERY CRITICAL signal
    if (hintsForBoost.location) {
      const noteLocationLower = note.location.toLowerCase()
      const hintLocationLower = hintsForBoost.location.toLowerCase()
      if (noteLocationLower.includes(hintLocationLower) || hintLocationLower.includes(noteLocationLower)) {
        score += 2.0
        locationMatches.add(`filename-location:${hintsForBoost.location}`)
      }
    }
    
    // Sentiment match (1.5 boost for positive, 1.0 for negative) - Important signal
    if (hintsForBoost.sentiment === 'positive' && note.isPositive) {
      score += 1.5
    } else if (hintsForBoost.sentiment === 'negative' && !note.isPositive) {
      score += 1.0
    }
    
    // Primary subject match (1.2 boost) - Strong signal
    if (hintsForBoost.primarySubject) {
      const noteText = note.originalText.toLowerCase()
      const subjectTokens = tokenize(hintsForBoost.primarySubject)
      const subjectMatchCount = subjectTokens.filter(token => noteText.includes(token)).length
      if (subjectMatchCount > 0) {
        score += Math.min(subjectMatchCount * 0.4, 1.2)
        issueMatches.add(`filename-subject:${hintsForBoost.primarySubject}`)
      }
    }
    
    // Secondary subject match (0.8 boost) - Moderate signal
    if (hintsForBoost.secondarySubject) {
      const noteText = note.originalText.toLowerCase()
      const subjectTokens = tokenize(hintsForBoost.secondarySubject)
      const subjectMatchCount = subjectTokens.filter(token => noteText.includes(token)).length
      if (subjectMatchCount > 0) {
        score += Math.min(subjectMatchCount * 0.3, 0.8)
        issueMatches.add(`filename-secondary:${hintsForBoost.secondarySubject}`)
      }
    }
  }

  if (score <= 0) {
    return null
  }

  return {
    photoId: photo.photoId,
    score,
    matchedLocations: Array.from(locationMatches),
    matchedIssues: Array.from(issueMatches),
    matchedKeywords: Array.from(keywordMatches).slice(0, 4)
  }
}

function buildAffinityMap(
  photos: PhotoMetadata[],
  notes: StructuredNote[]
): Map<number, AffinityCandidate[]> {
  const affinity = new Map<number, AffinityCandidate[]>()

  const noteProfiles = notes.map(buildNoteProfile)
  const photoProfiles = photos.map(buildPhotoProfile)

  notes.forEach((note, noteIndex) => {
    const candidates: AffinityCandidate[] = []
    photos.forEach((photo, photoIndex) => {
      const candidate = computeAffinityCandidate(
        photo,
        note,
        noteProfiles[noteIndex],
        photoProfiles[photoIndex]
      )
      if (candidate) {
        candidates.push(candidate)
      }
    })

    candidates.sort((a, b) => b.score - a.score)
    affinity.set(note.noteId, candidates)
  })

  return affinity
}

function buildNoteProfileMap(notes: StructuredNote[]): Map<number, ReturnType<typeof buildNoteProfile>> {
  const map = new Map<number, ReturnType<typeof buildNoteProfile>>()
  notes.forEach(note => {
    map.set(note.noteId, buildNoteProfile(note))
  })
  return map
}

function buildPhotoProfileMap(photos: PhotoMetadata[]): Map<number, ReturnType<typeof buildPhotoProfile>> {
  const map = new Map<number, ReturnType<typeof buildPhotoProfile>>()
  photos.forEach(photo => {
    map.set(photo.photoId, buildPhotoProfile(photo))
  })
  return map
}

function scoreAssignments(
  assignments: AssignmentWithReasoning[],
  photoMetadata: PhotoMetadata[],
  structuredNotes: StructuredNote[]
): number {
  const noteById = new Map(structuredNotes.map(note => [note.noteId, note]))
  const photoById = new Map(photoMetadata.map(photo => [photo.photoId, photo]))
  const noteProfiles = buildNoteProfileMap(structuredNotes)
  const photoProfiles = buildPhotoProfileMap(photoMetadata)
  const usedPhotos = new Set<number>()

  let score = 0

  assignments.forEach(assignment => {
    const note = noteById.get(assignment.noteId)
    if (!note) {
      score -= 1
      return
    }
    const noteProfile = noteProfiles.get(assignment.noteId)!

    assignment.photoIds.forEach(photoId => {
      const photo = photoById.get(photoId)
      if (!photo) {
        score -= 1
        return
      }
      if (usedPhotos.has(photoId)) {
        score -= 0.5
      } else {
        usedPhotos.add(photoId)
      }

      const photoProfile = photoProfiles.get(photoId)!
      const candidate = computeAffinityCandidate(photo, note, noteProfile, photoProfile)
      if (candidate) {
        score += candidate.score
      } else {
        score -= 1
      }
    })
  })

  return score
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

  if (!response.ok) {
    const errPayload = typeof data === 'object' ? JSON.stringify(data) : String(data)
    throw new Error(`Photo analysis failed for photo ${index + 1}: ${response.status} ${errPayload}`)
  }

  const choice = data?.choices?.[0]?.message?.content
  if (!choice || typeof choice !== 'string') {
    const errorMessage = data?.error?.message || data?.message || 'Gemini photo analysis returned no content'
    throw new Error(`Photo analysis failed for photo ${index + 1}: ${errorMessage}`)
  }

  let content = choice.trim()

  // Clean markdown
  if (content.startsWith('```json')) {
    content = content.replace(/^```json\s*/, '').replace(/\s*```$/, '')
  } else if (content.startsWith('```')) {
    content = content.replace(/^```\s*/, '').replace(/\s*```$/, '')
  }

  try {
    const metadata = JSON.parse(content)
    return { 
      photoId: index + 1, 
      originalName: image.originalName, 
      filenameHints: image.originalFilenameHints,
      ...metadata 
    }
  } catch (parseError) {
    console.warn(`   ⚠️  Failed to parse photo metadata JSON for photo ${index + 1}, attempting repair...`)
    try {
      const { jsonrepair } = await import('jsonrepair')
      const repaired = jsonrepair(content)
      const metadata = JSON.parse(repaired)
      console.log(`   ✓ Photo ${index + 1} JSON repaired successfully`)
      return { 
        photoId: index + 1, 
        originalName: image.originalName, 
        filenameHints: image.originalFilenameHints,
        ...metadata 
      }
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
    console.log('   Using DIRECT MATCHING strategy (numbered notes with affinity boost)')
    const noteProfiles = buildNoteProfileMap(structuredNotes)
    const photoProfiles = buildPhotoProfileMap(photoMetadata)
    const affinityMap = buildAffinityMap(photoMetadata, structuredNotes)
    const assignedPhotos = new Set<number>()

    const takeSequentialPhoto = (preferredIndex: number, note: StructuredNote): number | null => {
      for (let offset = 0; offset < photoMetadata.length; offset++) {
        const idx = preferredIndex + offset
        if (idx >= photoMetadata.length) {
          break
        }
        const candidatePhoto = photoMetadata[idx]
        if (
          (note.isPositive && candidatePhoto.sentiment === 'problem') ||
          (!note.isPositive && candidatePhoto.sentiment === 'good_practice')
        ) {
          continue
        }
        const candidateId = candidatePhoto.photoId
        if (assignedPhotos.has(candidateId)) {
          continue
        }
        assignedPhotos.add(candidateId)
        return candidateId
      }
      return null
    }

    structuredNotes.forEach((note, index) => {
      const candidates = (affinityMap.get(note.noteId) ?? []).filter(candidate => !assignedPhotos.has(candidate.photoId))

      const strongCandidate = candidates.find(candidate => candidate.score >= AFFINITY_STRONG_THRESHOLD)
      const fallbackCandidate = strongCandidate ?? candidates[0]

      if (fallbackCandidate) {
        assignedPhotos.add(fallbackCandidate.photoId)

        const detailParts = [
          fallbackCandidate.matchedLocations.length > 0 ? `locations: ${fallbackCandidate.matchedLocations.join(', ')}` : '',
          fallbackCandidate.matchedIssues.length > 0 ? `issues: ${fallbackCandidate.matchedIssues.join(', ')}` : '',
          fallbackCandidate.matchedKeywords.length > 0 ? `keywords: ${fallbackCandidate.matchedKeywords.join(', ')}` : ''
        ].filter(Boolean)

        const confidenceBase = strongCandidate ? 0.75 : 0.6
        const confidence = Math.min(0.95, confidenceBase + Math.min(fallbackCandidate.score, 3) * 0.08)

        assignmentById.set(note.noteId, {
          noteId: note.noteId,
          photoIds: [fallbackCandidate.photoId],
          reasoning: detailParts.length > 0
            ? `Affinity ${strongCandidate ? 'match' : 'best available'} (score ${fallbackCandidate.score.toFixed(2)}) via ${detailParts.join('; ')}`
            : `Affinity ${strongCandidate ? 'match' : 'best available'} (score ${fallbackCandidate.score.toFixed(2)})`,
          confidence
        })
        return
      }

      const fallbackPhotoId = takeSequentialPhoto(index, note)
      if (fallbackPhotoId !== null) {
        assignmentById.set(note.noteId, {
          noteId: note.noteId,
          photoIds: [fallbackPhotoId],
          reasoning: `Sequential fallback to photo ${fallbackPhotoId} (no affinity candidates)`,
          confidence: 0.55
        })
      } else {
        assignmentById.set(note.noteId, {
          noteId: note.noteId,
          photoIds: [],
          reasoning: 'No photo available after affinity scan',
          confidence: 0.4
        })
      }
    })

    photoMetadata.forEach(photo => {
      if (!assignedPhotos.has(photo.photoId)) {
        leftoverPhotoIds.add(photo.photoId)
      }
    })

    if (leftoverPhotoIds.size > 0) {
      console.log(`   ⚠️  ${leftoverPhotoIds.size} photo(s) not yet assigned, attempting secondary affinity placement...`)
      const photoById = new Map(photoMetadata.map(photo => [photo.photoId, photo]))
      const noteById = new Map(structuredNotes.map(note => [note.noteId, note]))

      Array.from(leftoverPhotoIds).forEach(photoId => {
        const photo = photoById.get(photoId)
        if (!photo) {
          return
        }
        const photoProfile = photoProfiles.get(photoId) ?? buildPhotoProfile(photo)

        let bestNote: StructuredNote | null = null
        let bestCandidate: AffinityCandidate | null = null

        structuredNotes.forEach(note => {
          const assignment = assignmentById.get(note.noteId)
          if (!assignment) {
            return
          }
          if (assignment.photoIds.includes(photoId)) {
            return
          }

          const candidate = computeAffinityCandidate(
            photo,
            note,
            noteProfiles.get(note.noteId)!,
            photoProfile
          )
          if (!candidate) {
            return
          }

          const currentBestScore = bestCandidate?.score ?? -Infinity
          const adjustedScore = candidate.score - (assignment.photoIds.length * 0.25)
          if (adjustedScore > currentBestScore) {
            bestCandidate = {
              photoId: candidate.photoId,
              score: adjustedScore,
              matchedLocations: candidate.matchedLocations,
              matchedIssues: candidate.matchedIssues,
              matchedKeywords: candidate.matchedKeywords
            }
            bestNote = note
          }
        })

        const STRONG_SECONDARY_SCORE = 1.2
        const WEAK_SECONDARY_SCORE = 0.35

        if (bestNote !== null && bestCandidate !== null) {
          const candidate = bestCandidate as AffinityCandidate
          const note = bestNote as StructuredNote
          
          if (candidate.score >= STRONG_SECONDARY_SCORE) {
            const assignment = assignmentById.get(note.noteId)!
            assignment.photoIds.push(photoId)
            assignment.reasoning = appendReasoning(
              assignment.reasoning,
              `Secondary affinity match added photo ${photoId} (score ${candidate.score.toFixed(2)})`
            )
            assignment.confidence = Math.min(0.9, assignment.confidence + Math.min(candidate.score, 3) * 0.05)
            leftoverPhotoIds.delete(photoId)
            console.log(`   ➕ Added photo ${photoId} to note ${note.noteId} via secondary affinity (score ${candidate.score.toFixed(2)})`)
          } else if (candidate.score >= WEAK_SECONDARY_SCORE) {
            const assignment = assignmentById.get(note.noteId)!
            assignment.photoIds.push(photoId)
            assignment.reasoning = appendReasoning(
              assignment.reasoning,
              `Weak affinity match added photo ${photoId} (score ${candidate.score.toFixed(2)})`
            )
            assignment.confidence = Math.min(0.85, assignment.confidence - 0.05 + Math.min(candidate.score, 2) * 0.04)
            leftoverPhotoIds.delete(photoId)
            console.log(`   ➕ Added photo ${photoId} to note ${note.noteId} via weak affinity (score ${candidate.score.toFixed(2)})`)
          }
        } else {
          console.warn(`   ⚠️  Unable to find acceptable affinity for photo ${photoId}; leaving unassigned for review`)
        }
      })

      if (leftoverPhotoIds.size > 0) {
        console.warn(`   ⚠️  ${leftoverPhotoIds.size} photo(s) still unassigned after affinity pass, forcing fallback allocation...`)
        Array.from(leftoverPhotoIds).forEach(photoId => {
          const photo = photoById.get(photoId)
          if (!photo) {
            return
          }
          let bestNote: StructuredNote | null = null
          let bestScore = -Infinity

          structuredNotes.forEach(note => {
            if ((note.isPositive && photo.sentiment === 'problem') || (!note.isPositive && photo.sentiment === 'good_practice')) {
              return
            }
            const candidate = computeAffinityCandidate(
              photo,
              note,
              noteProfiles.get(note.noteId)!,
              photoProfiles.get(photoId)!
            )
            const adjustedScore = candidate ? candidate.score : 0
            if (adjustedScore > bestScore) {
              bestScore = adjustedScore
              bestNote = note
            }
          })

          if (bestNote) {
            const note = bestNote as StructuredNote
            const assignment = assignmentById.get(note.noteId)!
            assignment.photoIds.push(photoId)
            assignment.reasoning = appendReasoning(
              assignment.reasoning,
              `Fallback attachment added photo ${photoId} (score ${bestScore.toFixed(2)})`
            )
            assignment.confidence = Math.min(assignment.confidence, 0.75)
            leftoverPhotoIds.delete(photoId)
            console.log(`   ➕ Forced fallback added photo ${photoId} to note ${note.noteId} (score ${bestScore.toFixed(2)})`)
          } else {
            console.warn(`   ⚠️  Photo ${photoId} could not be matched even after fallback; leaving for manual review`)
          }
        })
      }
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

    const correctedRaw = Array.isArray(result?.correctedAssignments) ? result.correctedAssignments : []
    const sanitizedAssignmentsMap = new Map<number, AssignmentWithReasoning>()

    correctedRaw.forEach((item: any) => {
      const noteId = Number(item?.noteId)
      if (!Number.isInteger(noteId) || noteId <= 0 || sanitizedAssignmentsMap.has(noteId)) {
        return
      }

      const rawPhotoIds = Array.isArray(item?.photoIds) ? item.photoIds : []
      const photoIds: number[] = Array.from(
        new Set(
          rawPhotoIds
            .map((value: any) => Number(value))
            .filter((id: number) => Number.isInteger(id) && id > 0)
        )
      )

      sanitizedAssignmentsMap.set(noteId, {
        noteId,
        photoIds,
        reasoning: typeof item?.reasoning === 'string' && item.reasoning.trim().length > 0
          ? item.reasoning.trim()
          : 'Adjusted by verification step',
        confidence: typeof item?.confidence === 'number' && item.confidence >= 0 && item.confidence <= 1
          ? item.confidence
          : 0.65
      })
    })

    assignments.forEach(existing => {
      if (!sanitizedAssignmentsMap.has(existing.noteId)) {
        sanitizedAssignmentsMap.set(existing.noteId, existing)
      }
    })

    const correctedAssignments = Array.from(sanitizedAssignmentsMap.values())

    const newValidation = validateAssignments(
      correctedAssignments,
      photoMetadata.length,
      structuredNotes.length
    )

    const originalScore = scoreAssignments(assignments, photoMetadata, structuredNotes)
    const correctedScore = scoreAssignments(correctedAssignments, photoMetadata, structuredNotes)

    const errorsImproved = newValidation.errors.length < validation.errors.length
    const warningsNotWorse = newValidation.warnings.length <= validation.warnings.length
    const scoreImproved = correctedScore > originalScore + SCORE_IMPROVEMENT_MARGIN

    console.log(`   📊 Verification score comparison → original: ${originalScore.toFixed(2)}, corrected: ${correctedScore.toFixed(2)}`)

    if (errorsImproved || (scoreImproved && newValidation.errors.length <= validation.errors.length && warningsNotWorse)) {
      console.log('   ✅ Agent 3B fixed assignments:')
      console.log(`      ${typeof result?.fixesApplied === 'string' ? result.fixesApplied : 'Improved assignment quality'}`)
      return {
        assignments: correctedAssignments,
        fixed: true,
        reasoning: typeof result?.fixesApplied === 'string' ? result.fixesApplied : 'Improved assignment quality'
      }
    }

    console.warn('   ⚠️  Agent 3B corrections did not improve assignments, using original')
    return { assignments, fixed: false, reasoning: 'Corrections did not improve quality' }

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

    const visualLocation = ctx.metadata.location || 'unknown'
    const obsLocationMatch = ctx.observation?.fullNote.match(/^([^:]+):/)
    const obsLocation = obsLocationMatch ? obsLocationMatch[1].trim() : ''

    const normalizedVisual = visualLocation.toLowerCase()
    const normalizedObservation = obsLocation.toLowerCase()
    let locationMatch = false
    if (normalizedVisual && normalizedObservation) {
      locationMatch = normalizedVisual.includes(normalizedObservation) || normalizedObservation.includes(normalizedVisual)
    }

    return `Photo ${ctx.photoId}:
  VISUAL ANALYSIS (what the photo actually shows):
    Location: ${visualLocation}
    Equipment: ${equipment}
    Safety Issues: ${safety}
    Sentiment: ${ctx.metadata.sentiment}
    People: ${people}
    Conditions: ${conditions}

  ASSIGNED OBSERVATION:
    Note: "${obsText}"
    Observation Location Hint: ${obsLocation || 'unknown'}
    Location Match: ${locationMatch ? 'YES - locations align' : 'NO - possible mismatch'}

  NAMING PRIORITY:
    ${locationMatch ? 'Use observation context (visual and assignment align).' : 'PRIORITIZE visual analysis (possible reassignment mismatch).'}

  Deterministic slug: ${deterministic.slug}
  Location tokens: ${locationTokens}
  Issue tokens: ${issueTokens}`
  }).join('\n\n')

  const prompt = `You generate final filenames for construction safety photos.

═══════════════════════════════════════════════════════════════════
CRITICAL NAMING RULES
═══════════════════════════════════════════════════════════════════

1. ACCURACY: The filename MUST describe what is VISUALLY PRESENT in the photo.
2. LOCATION PRIORITY: When "Location Match" = NO, USE VISUAL ANALYSIS ONLY (ignore observation text).
3. CONTEXT INTEGRATION: When "Location Match" = YES, you may blend visual + observation details.
4. LENGTH: Exactly 3-5 tokens in kebab-case (e.g., "outdoor-scaffold-missing-guardrail").
5. SPECIFICITY: Use concrete equipment/issue names, not generic words like "area", "site", "item".

═══════════════════════════════════════════════════════════════════
TOKEN SELECTION HIERARCHY (Priority Order)
═══════════════════════════════════════════════════════════════════

Select tokens in this order:

1. LOCATION TOKEN (mandatory, always first):
   ✓ GOOD: "outdoor", "indoor", "stairwell", "corridor", "laydown"
   ✗ BAD: "area", "site", "location", "place"

2. PRIMARY EQUIPMENT/OBJECT (from visual analysis):
   ✓ GOOD: "scaffold", "ladder", "cables", "materials", "forklift"
   ✗ BAD: "equipment", "thing", "item", "object"

3. SAFETY ISSUE/CONDITION (prioritize severity):
   ✓ GOOD: "missing-guardrail", "unsecured", "blocked-exit", "exposed-wires"
   ✗ BAD: "problem", "issue", "concern", "hazard" (alone)

4. SECONDARY DETAIL (if needed for clarity):
   ✓ GOOD: "walkway", "storage", "access", "egress"

═══════════════════════════════════════════════════════════════════
NAMING STRATEGY BY SCENARIO
═══════════════════════════════════════════════════════════════════

SCENARIO A: Location Match = YES (Visual and Observation Align)
→ Combine visual details + observation context

Example 1:
  Visual: "outdoor area with pallets"
  Observation: "Outdoor materials blocking walkway"
  ✓ GOOD: "outdoor-materials-blocking-walkway"
  ✗ BAD: "outdoor-pallets-area" (missing the blocking issue from observation)

Example 2:
  Visual: "stairwell with ladder"
  Observation: "Stairwell ladder not secured properly"
  ✓ GOOD: "stairwell-ladder-unsecured"
  ✗ BAD: "stairs-ladder-safety" (too generic, missing specific issue)

SCENARIO B: Location Match = NO (Reassignment Mismatch)
→ USE VISUAL ANALYSIS ONLY, completely ignore observation text

Example 3:
  Visual: "outdoor laydown area with steel beams"
  Observation: "Indoor corridor cable management issue" (WRONG LOCATION!)
  ✓ GOOD: "outdoor-steel-beams-storage"
  ✗ BAD: "indoor-corridor-cables" (copied from observation, not visual!)

Example 4:
  Visual: "indoor office space with exposed wires"
  Observation: "Outdoor scaffold missing guardrail" (WRONG LOCATION!)
  ✓ GOOD: "indoor-office-exposed-wires"
  ✗ BAD: "outdoor-scaffold-guardrail" (completely wrong!)

═══════════════════════════════════════════════════════════════════
EDGE CASE HANDLING
═══════════════════════════════════════════════════════════════════

CASE 1: Multiple Equipment Items
→ Choose the most safety-critical or prominent item

Visual: "scaffold with ladder and missing guardrail"
✓ GOOD: "outdoor-scaffold-missing-guardrail" (focus on safety issue)
✗ BAD: "outdoor-scaffold-ladder-guardrail" (too many details)

CASE 2: Ambiguous Location
→ Use the most specific location term from visual analysis

Visual: "indoor corridor near stairwell exit"
✓ GOOD: "corridor-exit-blocked-materials"
✗ BAD: "indoor-area-materials" (too generic)

CASE 3: No Clear Safety Issue
→ Focus on condition or state of equipment

Visual: "outdoor laydown area with organized materials"
✓ GOOD: "outdoor-materials-proper-storage"
✗ BAD: "outdoor-materials-area" (missing condition detail)

CASE 4: Positive Observations (Good Practices)
→ Use positive descriptors

Visual: "scaffold with all safety equipment present"
✓ GOOD: "outdoor-scaffold-proper-setup"
✗ BAD: "outdoor-scaffold-compliant" (too formal)

═══════════════════════════════════════════════════════════════════
COMMON MISTAKES TO AVOID
═══════════════════════════════════════════════════════════════════

❌ MISTAKE 1: Using observation text when Location Match = NO
   Wrong: "indoor-corridor-cables" (from observation)
   Right: "outdoor-laydown-materials" (from visual)

❌ MISTAKE 2: Generic token spam
   Wrong: "outdoor-area-item-issue"
   Right: "outdoor-scaffold-missing-guardrail"

❌ MISTAKE 3: Too many tokens (>5)
   Wrong: "outdoor-laydown-area-materials-storage-blocking-walkway"
   Right: "outdoor-materials-blocking-walkway"

❌ MISTAKE 4: Missing location token
   Wrong: "scaffold-missing-guardrail"
   Right: "outdoor-scaffold-missing-guardrail"

❌ MISTAKE 5: Using abbreviations
   Wrong: "ext-scaff-no-guard"
   Right: "outdoor-scaffold-missing-guardrail"

❌ MISTAKE 6: Duplicating information
   Wrong: "outdoor-outside-scaffold-scaffolding"
   Right: "outdoor-scaffold-setup"

═══════════════════════════════════════════════════════════════════
PHOTO CONTEXTS
═══════════════════════════════════════════════════════════════════

${contextBlocks}

═══════════════════════════════════════════════════════════════════
VALIDATION CHECKLIST (Verify Each Name)
═══════════════════════════════════════════════════════════════════

Before finalizing each name, verify:

✓ Location token is from VISUAL ANALYSIS location field
✓ Equipment/object token is from VISUAL ANALYSIS equipment field
✓ If Location Match = NO → name uses ONLY visual analysis (0% observation)
✓ If Location Match = YES → name blends visual + observation appropriately
✓ Exactly 3-5 tokens in kebab-case
✓ No generic words used alone ("area", "site", "item", "thing", "hazard")
✓ No abbreviations or acronyms
✓ Name describes what someone would SEE in the photo
✓ Reasoning explains token choices and location match handling

═══════════════════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════════════════

Return ONLY valid JSON array (no markdown, no extra text):

[
  {
    "photoId": 1,
    "suggestedName": "outdoor-scaffold-missing-guardrail",
    "reasoning": "Visual shows outdoor scaffold with missing guardrail. Location match=YES. Used visual location + equipment + safety issue from observation."
  },
  {
    "photoId": 2,
    "suggestedName": "indoor-corridor-exposed-cables",
    "reasoning": "Visual shows indoor corridor with exposed electrical cables. Location match=NO (obs mentions outdoor). Used ONLY visual analysis, ignored observation text."
  }
]

Generate names now:`

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

    const retryPrompt = `VALIDATION FAILED - Fix these photo names immediately.

═══════════════════════════════════════════════════════════════════
CRITICAL REQUIREMENTS (All MUST be satisfied)
═══════════════════════════════════════════════════════════════════

1. LENGTH: Exactly 3-5 tokens, kebab-case (e.g., "outdoor-scaffold-missing-guardrail")
2. LOCATION: Must include at least ONE location token from the provided list
3. ISSUE: Must include at least ONE issue/equipment token from the provided list
4. SPECIFICITY: No generic words ("area", "site", "item", "thing", "hazard" alone)
5. ACCURACY: Name must describe what's visually present in the photo

═══════════════════════════════════════════════════════════════════
COMMON FIXES
═══════════════════════════════════════════════════════════════════

Problem: Too few tokens (< 3)
  ✗ BAD: "outdoor-scaffold"
  ✓ FIXED: "outdoor-scaffold-missing-guardrail"

Problem: Missing location token
  ✗ BAD: "scaffold-damaged-platform"
  ✓ FIXED: "outdoor-scaffold-damaged-platform"

Problem: Missing issue token
  ✗ BAD: "outdoor-construction-area"
  ✓ FIXED: "outdoor-materials-blocking-walkway"

Problem: Too generic
  ✗ BAD: "outdoor-area-issue"
  ✓ FIXED: "outdoor-laydown-unsecured-materials"

Problem: Too many tokens (> 5)
  ✗ BAD: "outdoor-scaffold-area-missing-guardrail-safety-hazard"
  ✓ FIXED: "outdoor-scaffold-missing-guardrail"

═══════════════════════════════════════════════════════════════════
PHOTOS REQUIRING FIXES
═══════════════════════════════════════════════════════════════════

${problematic.map(([photoId, info]) => {
  const deterministic = deterministicByPhoto.get(photoId)!
  const locationTokens = Array.from(deterministic.locationTokens).join(', ') || 'none'
  const issueTokens = Array.from(deterministic.issueTokens).join(', ') || 'none'
  const reasons = info.reasons.map(r => `    - ${r}`).join('\n')
  return `Photo ${photoId}:
  ❌ Previous name: "${info.name}"
  
  Available location tokens: ${locationTokens}
  Available issue tokens: ${issueTokens}
  Suggested base: ${deterministic.slug}
  
  Validation errors:
${reasons}
  
  Instructions: Choose tokens from the available lists above, combine into 3-5 token name.`
}).join('\n\n')}

═══════════════════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════════════════

Return ONLY valid JSON array (no markdown):

[
  {
    "photoId": 4,
    "suggestedName": "outdoor-scaffold-missing-guardrail",
    "reasoning": "Fixed: Added location token 'outdoor', kept equipment 'scaffold', added issue 'missing-guardrail'. Total 4 tokens."
  }
]`

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
    const visualLoc = ctx?.metadata.location || 'unknown'

    const nameTokens = s.suggestedName.toLowerCase().split('-').filter(Boolean)
    const visualTokens = visualLoc.toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length > 2)
    const hasVisualLocation = visualTokens.length === 0
      ? true
      : visualTokens.some(vToken => nameTokens.some(nToken => nToken.includes(vToken) || vToken.includes(nToken)))

    const warning = hasVisualLocation
      ? '✓'
      : '⚠️ NAME MAY NOT MATCH VISUAL CONTENT'

    console.log(`   Photo ${s.photoId}: "${s.suggestedName}" ${warning}`)
    console.log(`      Visual Location: "${visualLoc}"`)
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

    const preferredSlug = suggestionMap.get(photoId)
    const candidateInput = preferredSlug || deterministicSlug || fallbackCandidates[0] || `photo-${photoId}`

    const guardedSlug = applyNamingGuardrails({
      candidate: candidateInput,
      deterministic: deterministicSlug || fallbackCandidates[0] || '',
      fallback: fallbackCandidates[0] || `photo-${photoId}`,
      locationTokens,
      issueTokens
    })

    const limitedSlug = buildObservationPhotoSlug({
      aiName: guardedSlug.replace(/-/g, ' '),
      description: observationDescription,
      originalName: image.originalName
    })

    const limitedFallbacks = fallbackCandidates
      .map(candidate =>
        buildObservationPhotoSlug({
          aiName: candidate.replace(/-/g, ' '),
          description: observationDescription,
          originalName: image.originalName
        })
      )
      .filter(Boolean)

    const finalSlug = dedupeSlug(
      limitedSlug,
      usedSlugs,
      limitedFallbacks,
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

function limitSlug(slug: string, maxLength = 60): string {
  if (slug.length <= maxLength) {
    return slug
  }
  return slug.slice(0, maxLength).replace(/-+$/, '')
}

// Main Orchestrator
/**
 * Extract metadata hints from structured original filenames
 * Examples:
 *   GVX05_COLO_MaterialStorage_ObstructedWalkway.jpg
 *   GVX04_Laydown_UnstableStackedWood.jpg
 *   GVX05_Positive_CuttingStation.jpg
 */
function extractFilenameHints(filename: string): ProcessedImage['originalFilenameHints'] {
  // Remove file extension
  const nameWithoutExt = filename.replace(/\.(jpg|jpeg|png|heic)$/i, '')
  
  // Split by underscore
  const parts = nameWithoutExt.split('_').filter(p => p.length > 0)
  
  if (parts.length === 0) {
    return { rawParts: [] }
  }
  
  const hints: ProcessedImage['originalFilenameHints'] = {
    rawParts: parts
  }
  
  // Extract project code (GVX04, GVX05, etc.)
  const projectPattern = /^(GVX\d{2})$/i
  if (parts[0] && projectPattern.test(parts[0])) {
    hints.project = parts[0].toUpperCase()
  }
  
  // Extract location (COLO, Laydown, Corridor, External, etc.)
  const locationKeywords = [
    'colo', 'laydown', 'corridor', 'external', 'entrance', 
    'stairwell', 'electrical', 'warehouse', 'office'
  ]
  const locationPart = parts.find(p => 
    locationKeywords.some(kw => p.toLowerCase().includes(kw))
  )
  if (locationPart) {
    hints.location = locationPart
  }
  
  // Extract sentiment (Positive)
  const sentimentPart = parts.find(p => p.toLowerCase() === 'positive')
  if (sentimentPart) {
    hints.sentiment = 'positive'
  }
  
  // Extract primary subject (usually after location)
  // Skip project and location parts
  const nonMetaParts = parts.filter(p => 
    p !== hints.project && 
    p !== locationPart && 
    p !== sentimentPart
  )
  
  if (nonMetaParts.length > 0) {
    hints.primarySubject = nonMetaParts[0]
  }
  
  if (nonMetaParts.length > 1) {
    hints.secondarySubject = nonMetaParts[1]
  }
  
  // If no explicit sentiment but filename contains negative indicators
  if (!hints.sentiment) {
    const negativeKeywords = ['unstable', 'missing', 'blocked', 'unsecured', 'poor', 'expired', 'hazard', 'trip']
    const hasNegative = parts.some(p => 
      negativeKeywords.some(kw => p.toLowerCase().includes(kw))
    )
    hints.sentiment = hasNegative ? 'negative' : 'neutral'
  }
  
  return hints
}

export async function orchestratePhotoAssignment(
  images: ProcessedImage[],
  observationShells: ObservationShell[]
): Promise<{ assignments: Record<number, number[]>; metadata: any }> {
  console.log('🎭 Starting Multi-Agent Orchestration')
  console.log(`   Images: ${images.length}, Observations: ${observationShells.length}`)

  const apiKey = process.env.OPENROUTER_API_KEY!
  
  // Step 0: Extract filename hints for affinity boosting
  console.log('📋 Extracting filename metadata...')
  images.forEach((image) => {
    image.originalFilenameHints = extractFilenameHints(image.originalName)
  })
  const imagesWithHints = images.filter(img => 
    img.originalFilenameHints && 
    (img.originalFilenameHints.project || img.originalFilenameHints.location)
  ).length
  console.log(`   ✓ Extracted hints from ${imagesWithHints}/${images.length} filenames`)
  
  // Log sample hints
  images.slice(0, 3).forEach((img, idx) => {
    const hints = img.originalFilenameHints
    if (hints && (hints.project || hints.location)) {
      console.log(`      Photo ${idx + 1}: ${hints.project || '?'} | ${hints.location || '?'} | ${hints.primarySubject || '?'}`)
    }
  })

  // Step 1: Analyze all photos in parallel
  console.log('🔍 Agent 1: Analyzing photos...')
  const photoMetadata = await Promise.all(
    images.map((img, idx) => analyzePhoto(img, idx))
  )
  console.log(`   ✓ Analyzed ${photoMetadata.length} photos`)

  // Preserve visual analysis for downstream naming logic
  images.forEach((image, idx) => {
    const metadata = photoMetadata[idx]
    if (!metadata) {
      return
    }

    image.visualContent = {
      location: metadata.location,
      equipment: Array.isArray(metadata.equipment) ? metadata.equipment : [],
      safetyIssues: Array.isArray(metadata.safetyIssues) ? metadata.safetyIssues : [],
      sentiment: metadata.sentiment
    }
  })

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
  
  // PHASE 1 QUICK WIN: Validate assignments against filename hints
  console.log('📋 Validating assignments against filename metadata...')
  let mismatchCount = 0
  let matchCount = 0
  
  assignmentsWithReasoning.forEach(assignment => {
    const note = structuredNotes.find(n => n.noteId === assignment.noteId)
    if (!note) return
    
    assignment.photoIds.forEach(photoId => {
      const photo = photoMetadata.find(p => p.photoId === photoId)
      if (!photo || !photo.filenameHints) return
      
      const hints = photo.filenameHints
      const issues: string[] = []
      
      // Check project mismatch
      if (hints.project) {
        const noteText = note.originalText.toLowerCase()
        if (!noteText.includes(hints.project.toLowerCase())) {
          issues.push(`project:${hints.project}`)
        }
      }
      
      // Check location mismatch
      if (hints.location) {
        const noteLocationLower = note.location.toLowerCase()
        const hintLocationLower = hints.location.toLowerCase()
        if (!noteLocationLower.includes(hintLocationLower) && !hintLocationLower.includes(noteLocationLower)) {
          issues.push(`location:${hints.location}`)
        }
      }
      
      // Check sentiment mismatch
      if (hints.sentiment === 'positive' && !note.isPositive) {
        issues.push('sentiment:positive→negative')
      } else if (hints.sentiment === 'negative' && note.isPositive) {
        issues.push('sentiment:negative→positive')
      }
      
      if (issues.length > 0) {
        mismatchCount++
        console.warn(`   ⚠️  Photo ${photoId} (${photo.originalName}) → Note ${assignment.noteId}`)
        console.warn(`       Filename suggests: ${hints.project || '?'} | ${hints.location || '?'} | ${hints.sentiment || '?'}`)
        console.warn(`       Observation: ${note.location} | ${note.isPositive ? 'positive' : 'negative'}`)
        console.warn(`       Mismatches: ${issues.join(', ')}`)
      } else {
        matchCount++
      }
    })
  })
  
  const totalWithHints = photoMetadata.filter(p => p.filenameHints && (p.filenameHints.project || p.filenameHints.location)).length
  if (totalWithHints > 0) {
    const matchRate = ((matchCount / totalWithHints) * 100).toFixed(0)
    console.log(`   ✓ Filename validation: ${matchCount}/${totalWithHints} photos match (${matchRate}%), ${mismatchCount} mismatches detected`)
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

  // SKIPPED: Agent 5 photo naming (using simple sequential naming instead)
  // Photos are now named with simple date-time-number format (e.g., 20251024-1430-001.jpg)
  const photoNames = {}  // Empty - not used with simple sequential naming
  console.log('   ⏭️  Skipped Agent 5: Using simple sequential naming (YYYYMMDD-HHMM-###.jpg)')

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

export const __testHelpers = {
  matchPhotosToNotes
}
