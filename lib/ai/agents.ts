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

// Agent 3: Matcher (Orchestrator)
async function matchPhotosToNotes(
  photoMetadata: PhotoMetadata[],
  structuredNotes: StructuredNote[],
  apiKey: string
): Promise<AssignmentWithReasoning[]> {

  console.log('   Detecting note pattern...')
  const notePattern = detectNotePattern(structuredNotes, photoMetadata.length)
  console.log(`   Note pattern detected: ${notePattern}`)

  // STRATEGY 1: Direct matching for numbered notes
  if (notePattern === 'numbered') {
    console.log('   Using DIRECT MATCHING strategy (numbered notes)')
    const simpleAssignments: AssignmentWithReasoning[] = []
    const assignedPhotos = new Set<number>()

    // Match photos 1-N to notes 1-N (one-to-one)
    const maxSimpleMatch = Math.min(photoMetadata.length, structuredNotes.length)

    for (let i = 0; i < maxSimpleMatch; i++) {
      const photo = photoMetadata[i]
      const note = structuredNotes[i]

      // Check sentiment compatibility
      const sentimentMatch =
        photo.sentiment === 'neutral' || // Neutral can match anything
        (photo.sentiment === 'problem' && !note.isPositive) ||
        (photo.sentiment === 'good_practice' && note.isPositive)

      if (sentimentMatch) {
        // Direct match: Photo N → Note N
        simpleAssignments.push({
          noteId: note.noteId,
          photoIds: [photo.photoId],
          reasoning: `Direct match: Photo ${photo.photoId} corresponds to Note ${note.noteId} (numbered notes workflow)`,
          confidence: 0.95
        })
        assignedPhotos.add(photo.photoId)
        console.log(`   Direct match: Photo ${photo.photoId} → Note ${note.noteId}`)
      } else {
        // Keep placeholder assignment so every note is represented (AI will re-evaluate later)
        simpleAssignments.push({
          noteId: note.noteId,
          photoIds: [],
          reasoning: `No direct match: Photo ${photo.photoId} sentiment ${photo.sentiment} vs note ${note.isPositive ? 'positive' : 'problem'} (placeholder for AI reassignment)`,
          confidence: 0.35
        })
        console.warn(`   ⚠️  Sentiment mismatch: Photo ${photo.photoId} (${photo.sentiment}) ↔ Note ${note.noteId} (${note.isPositive ? 'positive' : 'problem'})`)
      }

    }

    // If all photos are assigned, return early
    if (assignedPhotos.size === photoMetadata.length) {
      console.log(`   ✓ All ${photoMetadata.length} photos assigned using direct matching`)
      return simpleAssignments
    }

    // For remaining photos (excess photos beyond note count), use basic AI matching
    const unassignedPhotos = photoMetadata.filter(p => !assignedPhotos.has(p.photoId))

    if (unassignedPhotos.length === 0) {
      console.log(`   ✓ All photos assigned using direct matching`)
      return simpleAssignments
    }

    console.log(`   ⚠️  ${unassignedPhotos.length} excess photos need AI matching`)

    const photoSummaries = unassignedPhotos.map(p =>
      `Photo ${p.photoId}: Location="${p.location}" Sentiment=${p.sentiment} Issues=[${p.safetyIssues.join(', ')}] Equipment=[${p.equipment.join(', ')}]`
    ).join('\n')

    const noteSummaries = simpleAssignments.map(a => {
      const note = structuredNotes.find(n => n.noteId === a.noteId)
      const preview = note?.originalText.substring(0, 80) || 'Unknown note'
      if (a.photoIds.length === 0) {
        return `Note ${a.noteId}: NO PHOTO ASSIGNED - "${preview}..."`
      }
      return `Note ${a.noteId}: ALREADY HAS Photo ${a.photoIds.join(',')} - "${preview}..."`
    }).join('\n')

    const prompt = `${unassignedPhotos.length} excess photos need to be assigned to existing notes.

UNASSIGNED PHOTOS:
${photoSummaries}

EXISTING ASSIGNMENTS:
${noteSummaries}

TASK: Assign each excess photo to ONE existing note (multiple photos can go to same note).

RULES:
1. SENTIMENT MATCHING: problem photos → problem notes, positive → positive
2. Match by: location > issue type > keywords
3. Multiple photos can be assigned to the same note
4. Return JSON array with noteId, photoIds (array of photo IDs to ADD to that note)

Return JSON array: [{"noteId": 1, "photoIds": [19, 20], "reasoning": "...", "confidence": 0.8}]`

    console.log('   Sending request to AI matcher for excess photos...')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120000) // 2 minute timeout

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
      console.log('   AI matcher response received')

      if (!response.ok) {
        throw new Error(`AI matcher failed: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()
      let content = data.choices[0].message.content.trim()

      console.log('   Raw matcher response (first 200 chars):', content.substring(0, 200))

      // Remove markdown code blocks
      if (content.includes('```json')) {
        content = content.replace(/^[\s\S]*```json\s*/, '').replace(/\s*```[\s\S]*$/, '')
      } else if (content.includes('```')) {
        content = content.replace(/^[\s\S]*```\s*/, '').replace(/\s*```[\s\S]*$/, '')
      }

      // Try to extract JSON array if AI added explanatory text
      const jsonMatch = content.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        content = jsonMatch[0]
      }

      console.log('   Cleaned content (first 200 chars):', content.substring(0, 200))

      let aiAssignments: AssignmentWithReasoning[] = []

      try {
        aiAssignments = JSON.parse(content)
      } catch (parseError) {
        console.error('   Failed to parse JSON, attempting repair...')
        console.error('   Content:', content.substring(0, 500))

        // Try jsonrepair as last resort
        try {
          const { jsonrepair } = await import('jsonrepair')
          const repaired = jsonrepair(content)
          console.log('   JSON repaired successfully')
          aiAssignments = JSON.parse(repaired)
        } catch (repairError) {
          console.error('   JSON repair also failed, using fallback')
          // Fallback: assign excess photos to first compatible note
          aiAssignments = [{
            noteId: simpleAssignments[0].noteId,
            photoIds: unassignedPhotos.map(p => p.photoId),
            reasoning: 'Fallback: AI matching failed, grouped excess photos with first note',
            confidence: 0.3
          }]
        }
      }

      // Merge AI assignments with simple assignments
      const mergedAssignments = [...simpleAssignments]

      for (const aiAssignment of aiAssignments) {
        const existing = mergedAssignments.find(a => a.noteId === aiAssignment.noteId)
        if (existing) {
          // Add photos to existing assignment
          existing.photoIds.push(...aiAssignment.photoIds)
          existing.reasoning += ` + ${aiAssignment.reasoning}`
        } else {
          // New assignment (shouldn't happen, but handle it)
          mergedAssignments.push(aiAssignment)
        }
      }

      console.log('   ✓ Merged direct matches with AI assignments')
      return mergedAssignments

    } catch (error) {
      clearTimeout(timeout)
      if (error instanceof Error && error.name === 'AbortError') {
        console.error('   ❌ AI matcher timed out after 2 minutes')
        // Return simple assignments even if AI times out
        console.log('   ⚠️  Using direct matches only (AI timed out)')
        return simpleAssignments
      }
      console.error('   ❌ AI matcher error:', error)
      // Return simple assignments even if AI fails
      console.log('   ⚠️  Using direct matches only (AI failed)')
      return simpleAssignments
    }
  } // End of numbered notes strategy

  // STRATEGY 2: Enhanced AI matching for unnumbered notes
  console.log('   Using ENHANCED AI MATCHING strategy (unnumbered notes)')
  console.log('   Full context: photos + notes with chain-of-thought reasoning')

  // Build rich context for AI
  const photoDetails = photoMetadata.map(p => `
Photo ${p.photoId}:
  Location: ${p.location}
  Sentiment: ${p.sentiment}
  Safety Issues: ${p.safetyIssues.join(', ') || 'none'}
  Equipment: ${p.equipment.join(', ') || 'none'}
  People: ${p.people.join(', ') || 'none'}
  Conditions: ${p.conditions.join(', ') || 'none'}
  Confidence: ${p.confidence}
`).join('\n')

  const noteDetails = structuredNotes.map(n => `
Note ${n.noteId} [${n.isPositive ? 'POSITIVE' : 'PROBLEM'}]:
  Text: "${n.originalText}"
  Location: ${n.location}
  Issue Type: ${n.issueType}
  Keywords: ${n.keywords.slice(0, 10).join(', ')}
`).join('\n')

  const enhancedPrompt = `You are a construction safety photo matching expert. Match ${photoMetadata.length} photos to ${structuredNotes.length} observation notes.

CRITICAL RULES:
1. **SENTIMENT MUST MATCH**:
   - Photos with sentiment="problem" can ONLY match notes marked [PROBLEM]
   - Photos with sentiment="good_practice" can ONLY match notes marked [POSITIVE]
   - Photos with sentiment="neutral" can match either type
   - NEVER match a problem photo to a positive note or vice versa!

2. **EACH PHOTO GOES TO EXACTLY ONE NOTE**: No duplicates, no orphans

3. **MATCH BY**: First sentiment, then location, then issue type, then keywords

4. **MULTIPLE PHOTOS PER NOTE**: One note can have multiple photos if they relate to the same issue

PHOTOS:
${photoDetails}

NOTES:
${noteDetails}

STEP-BY-STEP REASONING:
1. First, list all photos and their sentiments
2. List all notes and their sentiments
3. For each photo, identify compatible notes (matching sentiment)
4. Choose the best note based on location/issue/keywords
5. Verify all ${photoMetadata.length} photos are assigned to exactly one note

Return ONLY this JSON format:
[
  {
    "noteId": 1,
    "photoIds": [1, 3, 5],
    "reasoning": "Photos 1, 3, 5 all show housekeeping problems in external area matching this note about scattered materials",
    "confidence": 0.9
  },
  {
    "noteId": 2,
    "photoIds": [2],
    "reasoning": "Photo 2 shows cable damage matching this note about electrical issues in COLO2",
    "confidence": 0.95
  }
]

Think step by step. Respect sentiment matching. Ensure all ${photoMetadata.length} photos are assigned.`

  console.log('   Sending enhanced AI request...')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 180000) // 3 minutes for complex matching

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
        messages: [{ role: 'user', content: enhancedPrompt }],
        temperature: 0.1 // Low temperature for consistent matching
      })
    })

    clearTimeout(timeout)

    if (!response.ok) {
      throw new Error(`Enhanced AI matcher failed: ${response.status}`)
    }

    const data = await response.json()
    let content = data.choices[0].message.content.trim()

    // Clean and extract JSON
    if (content.includes('```json')) {
      content = content.replace(/^[\s\S]*```json\s*/, '').replace(/\s*```[\s\S]*$/, '')
    } else if (content.includes('```')) {
      content = content.replace(/^[\s\S]*```\s*/, '').replace(/\s*```[\s\S]*$/, '')
    }

    const jsonMatch = content.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      content = jsonMatch[0]
    }

    let aiAssignments: AssignmentWithReasoning[]

    try {
      aiAssignments = JSON.parse(content)
    } catch (parseError) {
      const { jsonrepair } = await import('jsonrepair')
      const repaired = jsonrepair(content)
      aiAssignments = JSON.parse(repaired)
    }

    console.log(`   ✓ AI matched ${photoMetadata.length} photos to ${aiAssignments.length} notes`)
    return aiAssignments

  } catch (error) {
    clearTimeout(timeout)
    console.error('   ❌ Enhanced AI matching failed:', error)

    // Fallback: distribute photos evenly across notes based on sentiment
    console.log('   ⚠️  Using fallback: distributing photos by sentiment')
    const fallbackAssignments: AssignmentWithReasoning[] = []

    const problemPhotos = photoMetadata.filter(p => p.sentiment === 'problem' || p.sentiment === 'neutral')
    const positivePhotos = photoMetadata.filter(p => p.sentiment === 'good_practice')

    const problemNotes = structuredNotes.filter(n => !n.isPositive)
    const positiveNotes = structuredNotes.filter(n => n.isPositive)

    // Distribute problem photos
    problemPhotos.forEach((photo, idx) => {
      const noteIdx = idx % problemNotes.length
      const note = problemNotes[noteIdx]
      const existing = fallbackAssignments.find(a => a.noteId === note.noteId)
      if (existing) {
        existing.photoIds.push(photo.photoId)
      } else {
        fallbackAssignments.push({
          noteId: note.noteId,
          photoIds: [photo.photoId],
          reasoning: 'Fallback: Distributed by sentiment',
          confidence: 0.4
        })
      }
    })

    // Distribute positive photos
    positivePhotos.forEach((photo, idx) => {
      if (positiveNotes.length > 0) {
        const noteIdx = idx % positiveNotes.length
        const note = positiveNotes[noteIdx]
        const existing = fallbackAssignments.find(a => a.noteId === note.noteId)
        if (existing) {
          existing.photoIds.push(photo.photoId)
        } else {
          fallbackAssignments.push({
            noteId: note.noteId,
            photoIds: [photo.photoId],
            reasoning: 'Fallback: Distributed by sentiment',
            confidence: 0.4
          })
        }
      }
    })

    return fallbackAssignments
  }
}

// Agent 3B: Independent Verifier (using smarter model for validation)
async function verifyAndFixAssignments(
  assignments: AssignmentWithReasoning[],
  photoMetadata: PhotoMetadata[],
  structuredNotes: StructuredNote[],
  apiKey: string
): Promise<{ assignments: AssignmentWithReasoning[]; fixed: boolean; reasoning: string }> {
  console.log('🔍 Agent 3B: Independent verification using Claude Sonnet 4.5...')

  // First run basic validation
  const validation = validateAssignments(assignments, photoMetadata.length, structuredNotes.length)

  if (validation.valid && validation.warnings.length === 0) {
    console.log('   ✓ No issues detected, assignments verified')
    return { assignments, fixed: false, reasoning: 'All checks passed' }
  }

  console.log('   ⚠️  Issues detected, requesting AI verification:')
  validation.errors.forEach(e => console.log(`      ERROR: ${e}`))
  validation.warnings.forEach(w => console.log(`      WARNING: ${w}`))

  // Build detailed context for Claude
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
        model: 'anthropic/claude-sonnet-4.5', // Use Claude Sonnet 4.5 for best reasoning
        messages: [{ role: 'user', content: verificationPrompt }],
        temperature: 0.1
      })
    })

    clearTimeout(timeout)

    if (!response.ok) {
      console.warn(`   ⚠️  Claude Sonnet 4.5 verification failed: ${response.status}, using original assignments`)
      return { assignments, fixed: false, reasoning: 'Verification service unavailable' }
    }

    const data = await response.json()
    let content = data.choices[0].message.content.trim()

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
    errors.push(`Only ${assignedPhotos.size}/${photoCount} photos assigned`)
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
      errors.push(`Note ${a.noteId} has no photos assigned`)
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

  // Log ALL assignments for debugging (not just first 3)
  console.log('\n   🔍 PHOTO-TO-OBSERVATION ASSIGNMENTS:')
  photoContexts.forEach(ctx => {
    const obsText = ctx.observation?.fullNote || 'NO OBSERVATION ASSIGNED'
    console.log(`   Photo ${ctx.photoId}: "${obsText}"`)
  })
  console.log('')

  const prompt = `You are a photo naming expert for construction safety observations.

Your task is to create SHORT, DESCRIPTIVE filenames that capture what the observation is documenting.

PHOTO CONTEXTS:
${photoContexts.map(ctx => {
  const obs = ctx.observation
  const obsPreview = obs ? obs.fullNote : 'Unassigned photo'
  return `
Photo ${ctx.photoId}:
OBSERVATION TEXT: "${obsPreview}"
`
}).join('\n')}

CRITICAL INSTRUCTIONS:
1. Read each observation carefully
2. For PROBLEM observations: Extract key words describing the issue (e.g., "cable-damage", "poor-housekeeping", "blocked-exit")
3. For POSITIVE observations: Extract key words describing what's GOOD (e.g., "proper-ppe", "clean-walkways", "good-signage")
4. If location is mentioned, include it (e.g., "colo2", "external-area", "laydown")
5. Use kebab-case (lowercase with hyphens)
6. Maximum 4-5 words
7. NO generic names like "positive-observation" or "problem-photo"
8. Each name must be SPECIFIC and UNIQUE

EXAMPLES FOR PROBLEMS:
✅ "Jones Engineering - Cable damage in COLO2" → "cable-damage-colo2"
✅ "Poor housekeeping in laydown area" → "poor-housekeeping-laydown"
✅ "Fire exit blocked by equipment" → "blocked-fire-exit"
✅ "Missing hard hats in zone 3" → "missing-hard-hats-zone3"

EXAMPLES FOR POSITIVE OBSERVATIONS:
✅ "Positive - Proper PPE usage by workers" → "proper-ppe-usage"
✅ "Well maintained walkways and signage" → "clean-walkways-signage"
✅ "Good cutting station with fire extinguisher" → "good-cutting-station"
✅ "Mobile office with safety boards" → "mobile-office-safety-boards"
✅ "Compliant gloves and knife usage" → "compliant-gloves-knife"

❌ WRONG: "positive-observation" (too generic!)
❌ WRONG: "construction-site" (too vague)
❌ WRONG: "photo-1" (not descriptive)

Return ONLY this JSON format:
[
  {
    "photoId": 1,
    "suggestedName": "cable-damage-colo2",
    "reasoning": "Describes cable damage issue in COLO2 electrical room"
  },
  {
    "photoId": 2,
    "suggestedName": "proper-ppe-usage",
    "reasoning": "Positive observation about compliant PPE usage"
  }
]

BE SPECIFIC. NO GENERIC NAMES. Each name must clearly identify what the photo shows.`

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

  const data = await response.json()
  let content = data.choices[0].message.content.trim()

  if (content.startsWith('```json')) {
    content = content.replace(/^```json\s*/, '').replace(/\s*```$/, '')
  } else if (content.startsWith('```')) {
    content = content.replace(/^```\s*/, '').replace(/\s*```$/, '')
  }

  let suggestions: PhotoNameSuggestion[] = JSON.parse(content)

  console.log(`\n✅ Generated ${suggestions.length} photo names based on assigned observations\n`)

  // VALIDATION: Check for generic or poor quality names
  const genericNames = ['positive-observation', 'problem-photo', 'observation', 'photo', 'construction-site', 'site-photo']
  const problematicNames: { photoId: number; name: string; reason: string }[] = []

  suggestions.forEach(s => {
    // Check if name is too generic
    if (genericNames.includes(s.suggestedName.toLowerCase())) {
      problematicNames.push({
        photoId: s.photoId,
        name: s.suggestedName,
        reason: `Generic name "${s.suggestedName}" - not descriptive enough`
      })
    }

    // Check if name is too short (less than 2 words)
    const wordCount = s.suggestedName.split('-').length
    if (wordCount < 2) {
      problematicNames.push({
        photoId: s.photoId,
        name: s.suggestedName,
        reason: `Too short: "${s.suggestedName}" (${wordCount} word) - needs more detail`
      })
    }
  })

  // If validation fails, retry ONCE with feedback
  if (problematicNames.length > 0) {
    console.warn(`\n⚠️  Validation failed: ${problematicNames.length} names need improvement`)
    problematicNames.forEach(p => {
      console.warn(`   - Photo ${p.photoId}: ${p.reason}`)
    })

    console.log('\n🔄 Retrying Agent 5 with specific feedback...')

    const retryPrompt = `Your previous photo names had issues. Please fix ONLY these photos:

${problematicNames.map(p => {
  const ctx = photoContexts.find(c => c.photoId === p.photoId)
  const obs = ctx?.observation
  return `
Photo ${p.photoId}:
  Previous name: "${p.name}"
  Problem: ${p.reason}
  Observation: "${obs?.fullNote || 'No observation'}"

  Requirements:
  - Must be SPECIFIC (not generic like "positive-observation")
  - Must be DESCRIPTIVE (describe WHAT is shown)
  - Must have at least 2-3 words
  - Use kebab-case

  Examples of GOOD names:
  - For positive observations: "proper-ppe-gloves", "clean-walkways-signage", "mobile-office-boards"
  - For problems: "cable-damage-colo2", "poor-housekeeping-laydown", "unsecured-ladder"
`
}).join('\n')}

Return ONLY JSON array with improved names for these ${problematicNames.length} photos:
[
  {
    "photoId": 3,
    "suggestedName": "proper-signage-mixing-station",
    "reasoning": "Describes the positive observation about proper signage in DVS mixing station"
  }
]

BE SPECIFIC. NO GENERIC NAMES.`

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
          temperature: 0.3
        })
      })

      if (retryResponse.ok) {
        const retryData = await retryResponse.json()
        let retryContent = retryData.choices[0].message.content.trim()

        if (retryContent.startsWith('```json')) {
          retryContent = retryContent.replace(/^```json\s*/, '').replace(/\s*```$/, '')
        } else if (retryContent.startsWith('```')) {
          retryContent = retryContent.replace(/^```\s*/, '').replace(/\s*```$/, '')
        }

        const improvedSuggestions: PhotoNameSuggestion[] = JSON.parse(retryContent)

        // Merge improved suggestions back into original
        improvedSuggestions.forEach(improved => {
          const idx = suggestions.findIndex(s => s.photoId === improved.photoId)
          if (idx !== -1) {
            suggestions[idx] = improved
            console.log(`   ✓ Improved Photo ${improved.photoId}: "${improved.suggestedName}"`)
          }
        })

        console.log(`\n✅ Retry successful: improved ${improvedSuggestions.length} names`)
      }
    } catch (retryError) {
      console.error('⚠️  Retry failed, using original names:', retryError)
    }
  }

  // Log ALL final suggestions with their observation context for verification
  console.log('\n   📋 FINAL GENERATED NAMES:')
  suggestions.forEach(s => {
    const ctx = photoContexts.find(c => c.photoId === s.photoId)
    const obsText = ctx?.observation?.fullNote || 'No observation'
    console.log(`\n   Photo ${s.photoId}: "${s.suggestedName}"`)
    console.log(`      Observation: "${obsText.substring(0, 100)}..."`)
    console.log(`      AI Reasoning: ${s.reasoning}`)
  })
  console.log('')

  // Convert to Record format
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
    suggestions: sanitizedSuggestions
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
}): Record<number, string> {
  const { images, observations, suggestions } = options

  const suggestionMap = new Map<number, string>()
  const usedSlugs = new Set<string>()
  const photoNames: Record<number, string> = {}

  for (const suggestion of suggestions) {
    const photoId = Number(suggestion.photoId)
    if (!Number.isInteger(photoId) || photoId < 1 || photoId > images.length) {
      continue
    }

    const sanitized = sanitizeSuggestedSlug(suggestion.suggestedName)
    if (sanitized) {
      suggestionMap.set(photoId, sanitized)
    }
  }

  images.forEach((image, index) => {
    const photoId = index + 1
    const observation = observations[index]

    const observationDescription = typeof observation?.['Observation Description'] === 'string'
      ? observation['Observation Description']
      : ''

    const fallbackFromObservation = observationDescription
      ? generateSimplePhotoSlug(observationDescription)
      : ''

    const fallbackCandidates = [
      fallbackFromObservation,
      observationDescription,
      slugFromOriginalName(image.originalName),
      `photo-${photoId}`
    ]
      .map(candidate => sanitizeSuggestedSlug(candidate))
      .filter(Boolean)

    let fallbackSlug = fallbackCandidates.find(slug => wordCount(slug) >= 2)
      || fallbackCandidates[0]
      || sanitizeSuggestedSlug(`photo-${photoId}`)
      || `photo-${photoId}`

    if (wordCount(fallbackSlug) < 2) {
      fallbackSlug = sanitizeSuggestedSlug(`photo-${photoId}`) || `photo-${photoId}`
    }

    const preferredSlug = suggestionMap.get(photoId)
    const candidate = preferredSlug || fallbackSlug

    const finalSlug = dedupeSlug(
      enforceSlugRules(candidate, fallbackSlug),
      usedSlugs,
      fallbackCandidates,
      photoId
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

function enforceSlugRules(candidate: string, fallback: string): string {
  const cleaned = (candidate || '').replace(/-+/g, '-').replace(/^-|-$/g, '')

  if (!cleaned) {
    return fallback
  }

  if (wordCount(cleaned) < 2) {
    return fallback
  }

  return cleaned
}

function dedupeSlug(base: string, used: Set<string>, extras: string[], photoId: number): string {
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
    // Step 3B: Independent verification (uses Claude Sonnet 4.5 for superior reasoning)
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

    // Fallback: Fix missing assignments and orphaned photos
    const assignedPhotos = new Set<number>()
    assignmentsWithReasoning.forEach(a => {
      a.photoIds.forEach(pid => assignedPhotos.add(pid))
    })

    // Find orphaned photos (not assigned to any note)
    const orphanedPhotos: number[] = []
    for (let i = 1; i <= images.length; i++) {
      if (!assignedPhotos.has(i)) {
        orphanedPhotos.push(i)
      }
    }

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
      // No notes without photos, add orphaned photos to existing assignments
      console.log('🔧 Fallback: Distributing orphaned photos to existing assignments')
      orphanedPhotos.forEach((photoId, idx) => {
        const targetAssignment = assignmentsWithReasoning[idx % assignmentsWithReasoning.length]
        targetAssignment.photoIds.push(photoId)
        targetAssignment.reasoning += ` (Fallback: Added orphaned photo ${photoId})`
        console.log(`   Note ${targetAssignment.noteId} ← Photo ${photoId} (fallback)`)
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
