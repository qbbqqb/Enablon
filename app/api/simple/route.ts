import { NextRequest } from 'next/server'
import { randomUUID } from 'crypto'
import { jsonrepair } from 'jsonrepair'
import {
  PROJECTS,
  ROOM_AREAS,
  OBSERVATION_CATEGORIES,
  CATEGORY_TYPES,
  HRA_CATEGORIES,
  GENERAL_CATEGORIES,
  CONSTRUCTION_PHASES,
  SEVERITY_LEVELS,
  PROJECT_MAPPINGS,
  CONSTANTS
} from '@/lib/constants/enums'
import type { Project } from '@/lib/constants/enums'
import { normalizeImages } from '@/lib/files/normalize'
import { createZipStream, streamZipToBuffer } from '@/lib/zip/buildZip'
import type { Observation, ObservationDraft, FailedItem, ProcessedImage } from '@/lib/types'
import { sendProgressUpdate, closeProgressConnection } from '@/lib/progress/manager'
import type { ProgressEvent } from '@/lib/progress/manager'
import { setSessionData } from '@/lib/session/store'
import { analyzeImages } from '@/lib/ai/analyze'

export const runtime = 'nodejs'
export const maxDuration = 300

const SIMPLE_CHUNK_CONCURRENCY = 3
const DEFAULT_SIMPLE_CHUNK_SIZE = 6

interface PhotoContext {
  photoNumber: number
  originalName: string
  hint: string
  noteIndex?: number
  note?: string
}

function extractNotes(notes?: string): string[] {
  if (!notes) {
    return []
  }

  // Normalize line breaks (handle \n, \\n, actual newlines)
  const normalized = notes.replace(/\\n/g, '\n')

  // Try numbered notes first
  const numberedMatches: string[] = []
  const numberedRegex = /(\d+)\.\s+([^]*?)(?=\s+\d+\.\s+|$)/g
  let match: RegExpExecArray | null

  while ((match = numberedRegex.exec(normalized)) !== null) {
    const content = match[2]?.trim()
    if (content) {
      numberedMatches.push(content)
    }
  }

  if (numberedMatches.length > 0) {
    console.log(`Extracted ${numberedMatches.length} numbered notes from ${notes.length} chars`)
    return numberedMatches
  }

  // If no numbered notes, split by line breaks (each line is a note)
  const lineMatches = normalized
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 10) // Filter out very short lines (likely noise)

  console.log(`Extracted ${lineMatches.length} line-based notes from ${notes.length} chars`)
  return lineMatches
}

function logPhotoMatching(observations: any[], totalPhotos: number, notes: string[]) {
  console.log('\n📸 PHOTO-TO-OBSERVATION MATCHING RESULTS:')
  console.log('─'.repeat(80))

  const allMatchedPhotos = new Set<number>()
  let obsWithoutPhotos = 0
  let totalPhotoReferences = 0

  observations.forEach((obs, idx) => {
    // Check both raw photo_indices (from AI) and processed __photoIndices (after normalization)
    const rawPhotoIndices = (obs as any).photo_indices
    const processedPhotoIndices = (obs as any).__photoIndices
    const photoIndices = Array.isArray(rawPhotoIndices)
      ? rawPhotoIndices
      : (Array.isArray(processedPhotoIndices) ? processedPhotoIndices : [])

    const notePreview = notes[idx]?.substring(0, 60) || 'Unknown note'

    if (photoIndices.length === 0) {
      console.log(`⚠️  Obs ${idx + 1}: NO PHOTOS MATCHED`)
      console.log(`    Note: ${notePreview}...`)
      obsWithoutPhotos++
    } else {
      console.log(`✓  Obs ${idx + 1}: ${photoIndices.length} photo(s) → [${photoIndices.join(', ')}]`)
      console.log(`    Note: ${notePreview}...`)
      photoIndices.forEach((p: number) => allMatchedPhotos.add(p))
      totalPhotoReferences += photoIndices.length
    }
  })

  const orphanedPhotos = []
  for (let i = 1; i <= totalPhotos; i++) {
    if (!allMatchedPhotos.has(i)) {
      orphanedPhotos.push(i)
    }
  }

  console.log('─'.repeat(80))
  console.log(`📊 SUMMARY:`)
  console.log(`   Total observations: ${observations.length}`)
  console.log(`   Total photos available: ${totalPhotos}`)
  console.log(`   Photos matched: ${allMatchedPhotos.size}/${totalPhotos}`)
  console.log(`   Photos orphaned: ${orphanedPhotos.length} ${orphanedPhotos.length > 0 ? `→ [${orphanedPhotos.join(', ')}]` : ''}`)
  console.log(`   Observations without photos: ${obsWithoutPhotos}`)
  console.log(`   Total photo references: ${totalPhotoReferences}`)
  console.log(`   Avg photos per observation: ${(totalPhotoReferences / observations.length).toFixed(1)}`)
  console.log('─'.repeat(80) + '\n')
}

function generateHintFromFilename(name: string): string {
  const withoutExtension = name.replace(/\.[^.]+$/, '')
  const cleaned = withoutExtension
    .replace(/^(obs\s*\d+\s*-?)/i, '')
    .replace(/^(gvx\d+\s*-?)/i, '')
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) return 'unique detail from the image'

  const STOP_TOKENS = new Set([
    'obs',
    'observation',
    'image',
    'photo',
    'jpeg',
    'jpg',
    'img',
    'dvs',
    'gvx04',
    'gvx05',
    'gvx03',
    'colo',
    'externals',
    'co',
    'area',
    'other'
  ])

  const tokens = cleaned
    .split(' ')
    .map(token => token.trim())
    .filter(Boolean)
    .filter(token => !STOP_TOKENS.has(token.toLowerCase()) && !/^[0-9]+$/.test(token))

  const hint = tokens.length > 0 ? tokens.slice(0, 6).join(' ') : cleaned
  return hint.length > 80 ? hint.slice(0, 80) : hint
}

async function matchPhotosToNotes(
  images: ProcessedImage[],
  numberedNotes: string[]
): Promise<Map<number, number>> {
  const mapping = new Map<number, number>()

  // If no notes, return empty mapping
  if (numberedNotes.length === 0) {
    return mapping
  }

  // First, try to extract observation numbers from filenames
  for (let i = 0; i < images.length; i++) {
    const originalName = images[i]?.originalName || ''
    const obsMatch = /(?:^|[^\d])(?:obs|observation)\s*(\d+)/i.exec(originalName)

    if (obsMatch) {
      const obsNum = parseInt(obsMatch[1], 10)
      const zeroBasedIndex = obsNum - 1

      if (zeroBasedIndex >= 0 && zeroBasedIndex < numberedNotes.length) {
        mapping.set(i, zeroBasedIndex)
        console.log(`Photo ${i + 1} "${originalName}" → Note ${obsNum} (filename-based)`)
      }
    }
  }

  // If we successfully mapped all or most photos using filenames, we're done
  if (mapping.size >= images.length * 0.8) {
    console.log(`Mapped ${mapping.size}/${images.length} photos using filenames`)
    return mapping
  }

  // Otherwise, fall back to sequential mapping for unmapped photos
  console.log(`Only ${mapping.size}/${images.length} photos had obs numbers, using sequential fallback`)
  for (let i = 0; i < images.length; i++) {
    if (!mapping.has(i) && i < numberedNotes.length) {
      mapping.set(i, i)
    }
  }

  return mapping
}

function buildPhotoContexts(
  images: ProcessedImage[],
  numberedNotes: string[],
  photoToNoteMapping: Map<number, number>
): PhotoContext[] {
  const contexts: PhotoContext[] = []
  for (let i = 0; i < images.length; i++) {
    const originalName = images[i]?.originalName || `photo-${i + 1}`

    // Use AI-determined mapping
    const noteIndex = photoToNoteMapping.get(i)
    const note = typeof noteIndex === 'number' ? numberedNotes[noteIndex] : undefined

    const hint = generateHintFromFilename(originalName)
    contexts.push({
      photoNumber: i + 1,
      originalName,
      hint,
      noteIndex,
      note
    })
  }
  return contexts
}

function toCleanString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : fallback
  }

  if (value === null || value === undefined) {
    return fallback
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    const str = String(value).trim()
    return str.length > 0 ? str : fallback
  }

  if (Array.isArray(value) && value.length > 0) {
    return toCleanString(value[0], fallback)
  }

  return fallback
}

function pickFromList<T extends readonly string[], F extends string>(
  value: unknown,
  options: T,
  fallback: F
): T[number] | F {
  const target = toCleanString(value).toLowerCase()
  if (!target) return fallback

  const exact = options.find(option => option.toLowerCase() === target)
  if (exact) return exact

  const compactTarget = target.replace(/\s+/g, ' ')
  const compactMatch = options.find(option => option.toLowerCase() === compactTarget)
  if (compactMatch) return compactMatch

  const partial = options.find(option => option.toLowerCase().includes(target))
  return partial ?? fallback
}

function normalizeSentence(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''

  const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`
}

function enrichObservationWithContext(observation: any, context: PhotoContext | undefined): any {
  return observation
}

function hasDuplicateObservations(observations: Observation[]): boolean {
  const seen = new Set<string>()
  for (const obs of observations) {
    const desc = toCleanString(obs['Observation Description'], '').toLowerCase()
    const area = toCleanString(obs['Room/Area'], '').toLowerCase()
    const key = `${desc}::${area}`
    if (seen.has(key)) {
      return true
    }
    seen.add(key)
  }
  return false
}

function reportProgress(
  sessionId: string | undefined,
  progress: number,
  label: string,
  step: string,
  details?: ProgressEvent['details']
) {
  if (!sessionId) return
  sendProgressUpdate(sessionId, {
    id: sessionId,
    progress,
    label,
    step,
    details
  })
}

function scheduleProgressClose(sessionId: string | undefined) {
  if (!sessionId) return
  const timeout = setTimeout(() => {
    closeProgressConnection(sessionId)
  }, 4000)
  if (typeof (timeout as any)?.unref === 'function') {
    ;(timeout as any).unref()
  }
}

function normalizeObservation(
  raw: any,
  project: Project,
  notificationDate: string
): Observation {
  const mapping = PROJECT_MAPPINGS[project] ?? { responsibleParty: 'GC', personNotified: '' }

  let categoryType = pickFromList(raw?.['Category Type'], CATEGORY_TYPES, 'General Category')

  const observationCategory = pickFromList(
    raw?.['Observation Category'],
    OBSERVATION_CATEGORIES,
    'New At Risk Observation'
  )

  const roomArea = pickFromList(raw?.['Room/Area'], ROOM_AREAS, 'Other')
  const phase = pickFromList(raw?.['Phase of Construction'], CONSTRUCTION_PHASES, 'Integration')
  const severity = pickFromList(raw?.['Worst Potential Severity'], SEVERITY_LEVELS, 'Minor (7 Days)')

  let highRisk: typeof HRA_CATEGORIES[number] | '' = ''
  let generalCategory: typeof GENERAL_CATEGORIES[number] | '' = ''

  if (categoryType === 'HRA + Significant Exposure') {
    const selected = pickFromList(raw?.['High Risk + Significant Exposure'], HRA_CATEGORIES, '')
    if (selected && HRA_CATEGORIES.includes(selected as typeof HRA_CATEGORIES[number])) {
      highRisk = selected as typeof HRA_CATEGORIES[number]
    } else {
      categoryType = 'General Category'
      const generalCandidate = pickFromList(raw?.['General Category'], GENERAL_CATEGORIES, 'Other')
      generalCategory = GENERAL_CATEGORIES.includes(generalCandidate as typeof GENERAL_CATEGORIES[number])
        ? (generalCandidate as typeof GENERAL_CATEGORIES[number])
        : 'Other'
    }
  }

  if (categoryType === 'General Category') {
    const generalCandidate = pickFromList(raw?.['General Category'], GENERAL_CATEGORIES, 'Other')
    generalCategory = GENERAL_CATEGORIES.includes(generalCandidate as typeof GENERAL_CATEGORIES[number])
      ? (generalCandidate as typeof GENERAL_CATEGORIES[number])
      : 'Other'
    highRisk = ''
  }

  let interim = toCleanString(raw?.['Interim Corrective Actions'], 'N/A')
  if (interim.toUpperCase() === 'N/A') {
    interim = 'N/A'
  }
  const isPositive = observationCategory === 'New Positive Observation'

  const rawFinalSource = toCleanString(raw?.['Final Corrective Actions'])
  const sanitizedSource = rawFinalSource.toUpperCase() === 'N/A' ? '' : rawFinalSource
  const rawFinal = sanitizedSource
    .replace(/^OPEN\s*-\s*GC to action\.?\s*/i, '')
    .replace(/^(OPEN|CLOSED)\s*[-:]\s*/i, '')
    .trim()

  const formattedFinal = normalizeSentence(rawFinal)
  const finalActions = (isPositive
    ? `CLOSED - ${formattedFinal || 'Observation closed.'}`
    : `OPEN - GC to action.${formattedFinal ? ` ${formattedFinal}` : ''}`
  ).trim()

  let description = toCleanString(raw?.['Observation Description'], 'Observation requires review')
  if (description.toUpperCase() === 'N/A') {
    description = 'Observation requires review'
  }

  const observation: Observation = {
    Project: project,
    'Room/Area': roomArea,
    Comments: CONSTANTS.COMMENTS,
    'Observation Category': observationCategory,
    'Observation Description': description,
    'Responsible Party': mapping.responsibleParty || 'GC',
    'Interim Corrective Actions': interim,
    'Final Corrective Actions': finalActions,
    'Category Type': categoryType,
    'Phase of Construction': phase,
    'Notification Date': notificationDate,
    'High Risk + Significant Exposure': categoryType === 'HRA + Significant Exposure' ? highRisk : '',
    'General Category': categoryType === 'General Category' ? generalCategory : '',
    'Worst Potential Severity': severity,
    'Person Notified': mapping.personNotified || ''
  }

  // Extract photo indices from AI response
  const draft = observation as ObservationDraft
  if (Array.isArray(raw?.photo_indices)) {
    const extracted = raw.photo_indices
      .filter((i: unknown) => typeof i === 'number' && i >= 1)
      .map((i: number) => Math.floor(i)) // Ensure integers
    draft.__photoIndices = extracted
    console.log(`✓ Extracted ${extracted.length} photo indices:`, extracted)
  } else {
    // Debug: log what we received
    console.warn(`⚠️ No photo_indices found in AI response. Raw photo_indices:`, raw?.photo_indices)
    draft.__photoIndices = []
  }

  return observation
}

function adjustPhotoReferenceIndices(observation: any, offset: number): any {
  if (!observation || offset === 0) {
    return observation
  }

  const clone: Record<string, unknown> = { ...observation }

  if (typeof clone.photo_index === 'number') {
    clone.photo_index = clone.photo_index + offset
  }

  if (typeof clone.photoIndex === 'number') {
    clone.photoIndex = clone.photoIndex + offset
  }

  if (Array.isArray(clone.photo_indices)) {
    clone.photo_indices = clone.photo_indices.map(value =>
      typeof value === 'number' ? value + offset : value
    )
  }

  if (Array.isArray(clone.photoIndexes)) {
    clone.photoIndexes = clone.photoIndexes.map(value =>
      typeof value === 'number' ? value + offset : value
    )
  }

  return clone
}

interface SimpleAIOptions {
  images: ProcessedImage[]
  project: Project
  notificationDate: string
  notes?: string
  imageOffset: number
  totalImages: number
  avoidDescriptions?: string[]
  photoContexts: PhotoContext[]
  extractedNotes?: string[]
}

async function callSimpleAI(options: SimpleAIOptions): Promise<any[]> {
  const {
    images,
    project,
    notificationDate,
    notes,
    imageOffset,
    totalImages,
    avoidDescriptions,
    photoContexts,
    extractedNotes = []
  } = options

  const photoStart = imageOffset + 1
  const photoEnd = imageOffset + images.length
  const chunkContext =
    totalImages > images.length
      ? `You are analyzing a subset of photos ${photoStart} to ${photoEnd} out of ${totalImages}. Only describe the unique safety issue shown in each of these photos. Use the inspector notes to enrich details (location, contractor, immediate actions) for the matching issue.`
      : `You are analyzing all ${images.length} photos from this inspection.`

  const formattedAvoid = (avoidDescriptions ?? []).map(value => {
    const [descPart = value, areaPart = ''] = value.split('::')
    const trimmedDesc = descPart.trim() || value
    const trimmedArea = areaPart.trim()
    return trimmedArea ? `${trimmedDesc} (${trimmedArea || 'unspecified area'})` : trimmedDesc
  })

  const distinctInstructions = formattedAvoid.length > 0
    ? `AVOID DUPLICATE DESCRIPTIONS:\n- Do not reuse any of these existing observation descriptions: ${formattedAvoid
        .map(desc => `"${desc}"`)
        .join(', ')}\n- Mention at least one distinctive visual detail from the photo (colour of PPE, orientation of equipment, visible signage, etc.) so the observation is clearly unique.\n`
    : `DISTINCTIVE DETAIL REQUIREMENT:\n- Mention at least one distinctive visual element from the photo (colour of PPE, orientation of equipment, position of materials, signage text, etc.) so the observation is clearly tied to that image.\n`

  const chunkPhotoContexts = photoContexts.slice(imageOffset, imageOffset + images.length)

  // Check if we're in note-driven mode
  const hasNotes = extractedNotes && extractedNotes.length > 0
  const expectedObservations = hasNotes ? extractedNotes.length : images.length

  // Reduced logging for performance
  if (imageOffset === 0) {
    console.log(`AI: ${images.length} images → ${expectedObservations} observations (notes mode: ${hasNotes})`)
  }

  // Not needed anymore - we use workflowInstruction instead

  // NEW WORKFLOW: Notes drive observations, photos provide visual evidence
  const notesListText = extractedNotes.length > 0
    ? extractedNotes.map((note, idx) => `${idx + 1}. ${note}`).join('\n')
    : ''

  const workflowInstruction = extractedNotes.length > 0
    ? `NOTE-DRIVEN WORKFLOW:
You have ${extractedNotes.length} inspector notes and ${images.length} photos.

TASK: Create EXACTLY ${extractedNotes.length} observations (one per note).

INSPECTOR NOTES:
${notesListText}

INSTRUCTIONS:
- Each note describes one safety observation
- Use the photos as visual evidence to enrich the observation with specific details
- For EACH observation, identify which photos show evidence of this specific issue
- Focus on the safety issue stated in the note

PHOTO MATCHING (REQUIRED):
- For each observation, you MUST identify which photos show this specific issue
- Return "photo_indices": array of 1-based photo numbers [1-${images.length}]
- Look through ALL ${images.length} photos to find matches
- Match based on: equipment type, location markers, materials visible, hazards shown, people/PPE, contractor logos
- A photo can appear in multiple observations if it shows multiple issues
- Each observation MUST have at least one photo
- If uncertain whether a photo matches, INCLUDE IT (better to have extra context than miss evidence)
- Examples: [1], [2, 5, 6], [18, 19, 20]

MATCHING EXAMPLES:
- Note mentions "telehandler with flat tire" → Find photos showing telehandlers, especially with visible tire issues
- Note mentions "COLO3" → Find photos with COLO3 signage or that area
- Note mentions "IBC tank on pallets" → Find photos showing IBC tanks and pallet storage
- Note mentions "worker in MEWP" → Find photos showing MEWPs with people visible
- Note mentions "materials in corridor" → Find photos showing corridors with materials/obstructions`
    : `PHOTO-DRIVEN WORKFLOW:
- No inspector notes provided.
- Create one observation per photo (${images.length} total).
- Analyze each photo independently.
- Return "photo_indices": [n] where n is the 1-based photo number for this observation.`

  const prompt = `You are a construction safety inspector creating Enablon/Compass observations.

INPUT CONTEXT:
- Project: ${project}
- Expected notification date (Europe/Stockholm): ${notificationDate}
- Images: ${images.length} photos supplied as visual evidence
${distinctInstructions}

${workflowInstruction}

OUTPUT REQUIREMENTS:
Return EXACTLY ${expectedObservations} JSON objects inside a single array (no markdown, no commentary). Each object MUST use these exact keys and values from the allowed options:
- "Project": always "${project}".
- "Room/Area": choose the closest match from: ${ROOM_AREAS.join(', ')}.
- "Comments": use "${CONSTANTS.COMMENTS}".
- "Observation Category": choose from ${OBSERVATION_CATEGORIES.join(' | ')}.
- "Observation Description": A clear, professional statement of the SAFETY ISSUE or POSITIVE PRACTICE for Enablon upload. State ONLY the hazard/risk or good practice - DO NOT describe what is visible in photos (no colors, no "visible", no "a worker is", no "the equipment is"). This is a formal safety record, not a photo caption. Examples: "Uncapped rebars create impalement hazard", "Telehandler operating with deflated tire posing collision risk", "Proper use of bench and clamps for drilling operations".
- "Responsible Party": name the specific contractor if obvious, otherwise "GC".
- "Interim Corrective Actions": what was done immediately (or "N/A").
- "Final Corrective Actions": plain sentence describing follow-up or close-out. Do not add OPEN/CLOSED prefixes; the system handles that.
- "Category Type": choose from ${CATEGORY_TYPES.join(' | ')}.
- "Phase of Construction": choose from ${CONSTRUCTION_PHASES.join(', ')}.
- "Notification Date": exactly "${notificationDate}".
- "High Risk + Significant Exposure": pick from ${HRA_CATEGORIES.join(', ')} or "" if not applicable.
- "General Category": pick from ${GENERAL_CATEGORIES.join(', ')} or "" if not applicable.
- "Worst Potential Severity": choose from ${SEVERITY_LEVELS.join(' | ')}.
- "Person Notified": leave blank unless a person is explicitly named.
- "photo_indices": REQUIRED array of 1-based photo numbers that show this observation. Must have at least one photo. Examples: [1], [2, 5], [18, 19, 20].

EXCLUSIVITY RULES:
- If "Category Type" is "HRA + Significant Exposure", set "High Risk + Significant Exposure" and leave "General Category" empty.
- If "Category Type" is "General Category", set "General Category" and leave "High Risk + Significant Exposure" empty.

CRITICAL: Each observation MUST include "photo_indices" array.

Return only the JSON array with ${expectedObservations} observations.`

  const imageDataUrls = images.map(img =>
    `data:${img.mimeType};base64,${img.buffer.toString('base64')}`
  )

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.OPENROUTER_APP_URL || '',
      'X-Title': process.env.OPENROUTER_APP_NAME || 'Enablon Observation Bundler'
    },
    body: JSON.stringify({
      // Gemini 2.5 Pro Vision on OpenRouter supports multi-image input
      model: 'google/gemini-2.5-flash',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            // OpenAI-compatible content format supported by OpenRouter
            ...imageDataUrls.map(url => ({ type: 'image_url', image_url: url }))
          ]
        }
      ],
      max_tokens: 8000,
      temperature: 0.1
    })
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')

    let errorMessage = `${response.status} ${response.statusText}`
    if (text) {
      try {
        const parsed = JSON.parse(text)
        errorMessage = parsed?.error?.message || parsed?.message || parsed?.detail || text
      } catch (parseError) {
        errorMessage = text
      }
    }

    const error: Error & { status?: number; details?: string } = new Error(`OpenRouter API error: ${errorMessage}`)
    error.status = response.status
    if (text) {
      error.details = text
    }

    throw error
  }

  const data = await response.json()
  const rawContent = data.choices?.[0]?.message?.content

  const contentText = (() => {
    if (typeof rawContent === 'string') {
      return rawContent
    }

    if (Array.isArray(rawContent)) {
      return rawContent
        .map((part: unknown) => {
          if (!part) return ''
          if (typeof part === 'string') return part
          if (typeof (part as any).text === 'string') return (part as any).text
          if (typeof (part as any).content === 'string') return (part as any).content
          return ''
        })
        .filter(Boolean)
        .join('\n')
    }

    if (rawContent && typeof rawContent === 'object' && typeof (rawContent as any).text === 'string') {
      return (rawContent as any).text
    }

    if (typeof data.choices?.[0]?.message?.text === 'string') {
      return data.choices[0].message.text
    }

    return ''
  })()

  if (!contentText) {
    throw new Error('OpenRouter API error: empty response content')
  }

  // Clean markdown formatting
  let cleanContent = contentText.trim()
  if (cleanContent.startsWith('```json')) {
    cleanContent = cleanContent.replace(/^```json\s*/, '').replace(/\s*```$/, '')
  } else if (cleanContent.startsWith('```')) {
    cleanContent = cleanContent.replace(/^```\s*/, '').replace(/\s*```$/, '')
  }

  let observations
  try {
    observations = JSON.parse(cleanContent)
  } catch (error) {
    const initialError = error instanceof Error ? error.message : 'Unknown error'
    const truncatedContent = cleanContent.length > 2000 ? `${cleanContent.slice(0, 2000)}…` : cleanContent
    console.warn('AI response JSON parse failed, attempting repair:', initialError)

    try {
      const repairedContent = jsonrepair(cleanContent)
      observations = JSON.parse(repairedContent)
      console.warn('AI response required JSON repair before parsing succeeded')
    } catch (repairError) {
      console.error('Failed to parse AI response even after repair attempt:', truncatedContent)
      const repairMessage = repairError instanceof Error ? repairError.message : 'Unknown repair error'
      throw new Error(
        `Failed to parse AI response as JSON: ${initialError} (repair attempt: ${repairMessage})`
      )
    }
  }

  if (!Array.isArray(observations)) {
    throw new Error('AI response is not an array of observations')
  }

  // Debug: Check if first observation has photo_indices
  if (observations.length > 0) {
    console.log(`🔍 DEBUG: First observation photo_indices:`, observations[0]?.photo_indices)
  }

  const adjusted = imageOffset === 0
    ? observations
    : observations.map(obs => adjustPhotoReferenceIndices(obs, imageOffset))

  return adjusted
}

function resolveObservationPhotoIndices(
  rawObservations: any[],
  observationIndex: number,
  totalImages: number,
  photoContexts?: PhotoContext[]
): number[] {
  const raw = rawObservations[observationIndex]
  const indices = new Set<number>()

  const addIndex = (value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return
    }
    const zeroBased = value > 0 ? value - 1 : value
    indices.add(zeroBased)
  }

  if (raw && typeof raw === 'object') {
    if (typeof raw.photo_index === 'number') {
      addIndex(raw.photo_index)
    }

    if (typeof raw.photoIndex === 'number') {
      addIndex(raw.photoIndex)
    }

    if (Array.isArray(raw.photo_indices)) {
      raw.photo_indices.forEach(addIndex)
    }

    if (Array.isArray(raw.photoIndexes)) {
      raw.photoIndexes.forEach(addIndex)
    }

    if (Array.isArray(raw.photoIndices)) {
      raw.photoIndices.forEach(addIndex)
    }
  }

  // If we're in numbered notes mode, ALWAYS prefer note-based mapping over AI's photo_indices
  if (photoContexts && photoContexts.some(ctx => ctx.note)) {
    // Find all photos that have a note matching this observation index
    const matchingPhotoIndices: number[] = []
    photoContexts.forEach((ctx, idx) => {
      if (ctx.noteIndex === observationIndex && idx < totalImages) {
        matchingPhotoIndices.push(idx)
      }
    })

    if (matchingPhotoIndices.length > 0) {
      console.log(`Observation ${observationIndex}: using note-based mapping → photos ${matchingPhotoIndices.map(i => i + 1).join(', ')}`)
      return matchingPhotoIndices
    }
  }

  // Fallback to AI's photo_indices if available
  const unique = Array.from(indices).filter(index => index >= 0 && index < totalImages)

  if (unique.length > 0) {
    return unique
  }

  // Fallback to sequential mapping
  if (observationIndex < totalImages) {
    return [observationIndex]
  }

  if (totalImages === 0) {
    return []
  }

  return [Math.max(0, totalImages - 1)]
}

function mapObservationImages(
  rawObservations: any[],
  observations: Observation[],
  images: ProcessedImage[],
  photoContexts?: PhotoContext[]
): Array<{ indices: number[]; images: ProcessedImage[] }> {
  return observations.map((_, observationIndex) => {
    const resolvedIndices = resolveObservationPhotoIndices(rawObservations, observationIndex, images.length, photoContexts)
    const matchedImages: ProcessedImage[] = []
    const matchedIndices: number[] = []

    resolvedIndices.forEach(index => {
      const image = images[index]
      if (image) {
        matchedImages.push(image)
        matchedIndices.push(index)
      }
    })

    if (matchedImages.length === 0 && images.length > 0) {
      const fallbackIndex = Math.min(observationIndex, images.length - 1)
      const fallbackImage = images[fallbackIndex]
      if (fallbackImage) {
        matchedImages.push(fallbackImage)
        matchedIndices.push(fallbackIndex)
      }
    }

    return { indices: matchedIndices, images: matchedImages }
  })
}

function generateSimpleAttemptSizes(totalImages: number): number[] {
  const sizes: number[] = []
  const pushUnique = (size: number) => {
    const normalized = Math.max(1, Math.min(size, totalImages))
    if (!sizes.includes(normalized)) {
      sizes.push(normalized)
    }
  }

  // Optimized strategy: try only the most reliable chunk sizes
  if (totalImages <= 4) {
    pushUnique(totalImages)
  } else {
    // Chunk size 4 is most reliable (works well with Gemini)
    pushUnique(4)
    // Only add fallback if really needed
    pushUnique(2)
  }

  return sizes
}

async function tryChunkedSimpleAnalysis(options: {
  images: ProcessedImage[]
  project: Project
  notificationDate: string
  notes?: string
  chunkSize: number
  sessionId?: string
  totalImages: number
  photoContexts: PhotoContext[]
  extractedNotes?: string[]
}): Promise<any[] | null> {
  const { images, project, notificationDate, notes, chunkSize, sessionId, totalImages, photoContexts, extractedNotes = [] } = options
  if (totalImages === 0) {
    return []
  }

  // SPECIAL CASE: When we have extracted notes, send ALL photos at once (no chunking)
  // The AI needs all photos as visual evidence to create observations from notes
  if (extractedNotes && extractedNotes.length > 0) {
    console.log(`🎯 NOTE-DRIVEN MODE: Sending all ${images.length} photos to create ${extractedNotes.length} observations`)
    const observations = await callSimpleAI({
      images,
      project,
      notificationDate,
      notes,
      imageOffset: 0,
      totalImages,
      photoContexts,
      avoidDescriptions: undefined,
      extractedNotes
    })

    // Should get exactly one observation per note
    if (observations.length === extractedNotes.length) {
      console.log(`✅ Successfully created ${observations.length} observations from ${extractedNotes.length} notes`)

      // Log photo matching for verification
      logPhotoMatching(observations, images.length, extractedNotes)

      return observations
    }

    console.warn(`⚠️ Note-based analysis returned ${observations.length} observations, expected ${extractedNotes.length}`)
    return null
  }

  // NORMAL CASE: No notes, so chunk photos and create one observation per photo
  const chunks = [] as Array<{
    index: number
    start: number
    length: number
    images: ProcessedImage[]
    expectedObservations: number
  }>

  // Check if we're in "numbered notes mode" globally
  const hasAnyNumberedNotes = photoContexts.some(ctx => ctx.note)
  const totalNumberedNotes = photoContexts.filter(ctx => ctx.note).length

  for (let start = 0, chunkIndex = 0; start < totalImages; start += chunkSize, chunkIndex++) {
    const chunkImages = images.slice(start, start + chunkSize)
    const chunkContexts = photoContexts.slice(start, start + chunkSize)
    const photosWithNotes = chunkContexts.filter(ctx => ctx.note).length
    const expectedObservations = hasAnyNumberedNotes ? photosWithNotes : chunkImages.length

    chunks.push({
      index: chunkIndex,
      start,
      length: chunkImages.length,
      images: chunkImages,
      expectedObservations
    })
  }

  const chunkOutputs: any[][] = new Array(chunks.length)
  let processedChunks = 0
  let processedImages = 0

  try {
    for (let i = 0; i < chunks.length; i += SIMPLE_CHUNK_CONCURRENCY) {
      const batch = chunks.slice(i, i + SIMPLE_CHUNK_CONCURRENCY)
      const batchResults = await Promise.all(
        batch.map(async chunk => {
          const observations = await callSimpleAI({
            images: chunk.images,
            project,
            notificationDate,
            notes,
            imageOffset: chunk.start,
            totalImages,
            photoContexts,
            avoidDescriptions: undefined,
            extractedNotes
          })

          if (observations.length !== chunk.expectedObservations) {
            throw new Error(
              `Chunk starting at index ${chunk.start} returned ${observations.length} observations but expected ${chunk.expectedObservations} (${chunk.length} images with notes).`
            )
          }

          return { chunk, observations }
        })
      )

      batchResults.forEach(result => {
        chunkOutputs[result.chunk.index] = result.observations
        processedChunks += 1
        processedImages += result.chunk.length
      })

      const progressFraction = processedChunks / chunks.length
      const progressValue = 55 + Math.floor(progressFraction * 10)
      reportProgress(sessionId, Math.min(progressValue, 68), 'Analyzing images...', 'analysis', {
        processed: Math.min(processedImages, totalImages),
        total: totalImages
      })
    }
  } catch (error) {
    console.warn('Chunked simple analysis attempt failed:', error)
    return null
  }

  let aggregated = chunkOutputs.flat()
  const totalExpectedObservations = chunks.reduce((sum, chunk) => sum + chunk.expectedObservations, 0)

  if (aggregated.length !== totalExpectedObservations) {
    console.warn(
      `Chunked simple analysis produced ${aggregated.length} observations but expected ${totalExpectedObservations}.`
    )
    return null
  }

  const ensured = await ensureUniqueObservations({
    observations: aggregated,
    images,
    project,
    notificationDate,
    notes,
    totalImages,
    photoContexts: options.photoContexts
  })

  if (!ensured) {
    return null
  }

  return ensured
}

async function runSimpleAnalysis(options: {
  images: ProcessedImage[]
  project: Project
  notificationDate: string
  notes?: string
  sessionId?: string
  photoContexts: PhotoContext[]
  extractedNotes?: string[]
}): Promise<{ mode: 'simple' | 'chunked'; observations: any[] } | undefined> {
  const { images, project, notificationDate, notes, sessionId, photoContexts, extractedNotes = [] } = options
  const totalImages = images.length

  // Calculate expected observations based on notes (if present) or images
  const expectedObservations = extractedNotes.length > 0 ? extractedNotes.length : totalImages

  console.log(`runSimpleAnalysis: expecting ${expectedObservations} observations (${extractedNotes.length} notes, ${totalImages} images)`)

  const attemptSizes = generateSimpleAttemptSizes(totalImages)

  for (const chunkSize of attemptSizes) {
    const mode: 'simple' | 'chunked' = chunkSize === totalImages ? 'simple' : 'chunked'
    console.log(
      `Simple AI attempt with chunk size ${chunkSize} (${mode === 'simple' ? 'single request' : 'chunked'})`
    )

    const observations = await tryChunkedSimpleAnalysis({
      images,
      project,
      notificationDate,
      notes,
      chunkSize,
      sessionId,
      totalImages,
      photoContexts,
      extractedNotes
    })

    if (observations && observations.length === expectedObservations) {
      return { mode, observations }
    }
  }

  return undefined
}

async function runSinglePhotoAnalysis(options: {
  images: ProcessedImage[]
  project: Project
  notificationDate: string
  notes?: string
  sessionId?: string
  photoContexts: PhotoContext[]
}): Promise<any[] | null> {
  const { images, project, notificationDate, notes, photoContexts } = options
  const results: any[] = []
  const usedDescriptions = new Set<string>()

  for (let i = 0; i < images.length; i++) {
    try {
      const observationResponse = await callSimpleAI({
        images: [images[i]],
        project,
        notificationDate,
        notes,
        imageOffset: i,
        totalImages: images.length,
        avoidDescriptions: Array.from(usedDescriptions),
        photoContexts
      })

      if (!observationResponse || observationResponse.length !== 1) {
        console.warn(`Single-photo analysis returned unexpected result for photo ${i + 1}`)
        return null
      }

      const normalizedDesc = toCleanString(
        observationResponse[0]?.['Observation Description'],
        ''
      ).toLowerCase()

      if (normalizedDesc && usedDescriptions.has(normalizedDesc)) {
        console.warn(`Single-photo analysis produced duplicate description for photo ${i + 1}`)
        return null
      }

      if (normalizedDesc) {
        usedDescriptions.add(normalizedDesc)
      }

      results.push(observationResponse[0])
    } catch (error) {
      console.warn(`Single-photo analysis failed for photo ${i + 1}:`, error)
      return null
    }
  }

  return results
}

async function ensureUniqueObservations(params: {
  observations: any[]
  images: ProcessedImage[]
  project: Project
  notificationDate: string
  notes?: string
  totalImages: number
  photoContexts: PhotoContext[]
}): Promise<any[] | null> {
  let { observations } = params
  const { images, project, notificationDate, notes, totalImages, photoContexts } = params

  observations = observations.map((obs, index) => enrichObservationWithContext(obs, photoContexts[index]))

  const usedDescriptionKeys = new Set<string>()
  const usedDescriptions = new Set<string>()
  const duplicates = new Map<string, number[]>()

  observations.forEach((obs, index) => {
    const desc = toCleanString(obs?.['Observation Description'], '').toLowerCase()
    const area = toCleanString(obs?.['Room/Area'], '').toLowerCase()
    const key = `${desc}::${area}`
    if (!duplicates.has(key)) {
      duplicates.set(key, [])
    }
    duplicates.get(key)!.push(index)
    usedDescriptionKeys.add(key)
    if (desc) {
      usedDescriptions.add(desc)
    }
  })

  const duplicateGroups = Array.from(duplicates.values()).filter(indices => indices.length > 1)
  if (duplicateGroups.length === 0) {
    return observations
  }

  console.warn(`Repairing ${duplicateGroups.length} duplicate observation groups from chunked response`)

  for (const indices of duplicateGroups) {
    for (let i = 1; i < indices.length; i++) {
      const obsIndex = indices[i]
      const image = images[obsIndex]
      if (!image) {
        console.warn(`Missing image for observation index ${obsIndex}, cannot repair duplicate`)
        return null
      }

      const avoid = Array.from(usedDescriptions)
      const replacement = await callSimpleAI({
        images: [image],
        project,
        notificationDate,
        notes,
        imageOffset: obsIndex,
        totalImages,
        avoidDescriptions: avoid,
        photoContexts
      })

      if (!replacement || replacement.length !== 1) {
        console.warn(`Failed to repair duplicate observation at index ${obsIndex}`)
        return null
      }

      const newObservation = replacement[0]
      const newDesc = toCleanString(newObservation?.['Observation Description'], '').toLowerCase()
      const newArea = toCleanString(newObservation?.['Room/Area'], '').toLowerCase()
      const newKey = `${newDesc}::${newArea}`

      if (!newDesc || usedDescriptionKeys.has(newKey) || usedDescriptions.has(newDesc)) {
        console.warn(`Replacement observation is still not unique for index ${obsIndex}`)
        return null
      }

      observations[obsIndex] = newObservation
      usedDescriptionKeys.add(newKey)
      usedDescriptions.add(newDesc)
    }
  }

  return observations
}

export async function POST(request: NextRequest) {
  let sessionId: string | undefined = request.headers.get('x-session-id') ?? undefined

  try {
    console.log('=== Simple API Started ===')

    // Parse form data
    const formData = await request.formData()
    const fdAny = formData as any
    const project = (fdAny.get('project') as string) || ''
    const notes = (fdAny.get('notes') as string) || ''
    const mode = request.headers.get('X-Mode') || 'zip'
    const potentialSessionId = fdAny.get('sessionId')
    if (typeof potentialSessionId === 'string' && potentialSessionId.trim().length > 0) {
      sessionId = potentialSessionId.trim()
    }

    const notificationDate = new Intl.DateTimeFormat('en-GB', {
      timeZone: CONSTANTS.TIMEZONE
    }).format(new Date())

    const fileEntries = Array.from(fdAny.getAll('files')).filter((file: any) => {
      return file && file.name && file.size !== undefined && file.stream
    })

    console.log(`Project: ${project}, Notes: ${notes.length} chars, Files: ${fileEntries.length}, Mode: ${mode}, Session: ${sessionId || 'none'}`)

    reportProgress(sessionId, 5, 'Validating upload...', 'validation', {
      total: fileEntries.length
    })

    // Validate
    if (!project || !PROJECTS.includes(project as Project)) {
      return new Response('Invalid project', { status: 400 })
    }

    if (!fileEntries || fileEntries.length === 0) {
      return new Response('No files provided', { status: 400 })
    }

    // Step 1: Normalize images
    console.log('Normalizing images...')
    reportProgress(sessionId, 12, 'Normalizing images...', 'images', {
      total: fileEntries.length
    })
    const { images, failed } = await normalizeImages(fileEntries)

    if (images.length === 0) {
      return new Response('No valid images could be processed', { status: 400 })
    }

    console.log(`Normalized ${images.length} images`)

    const extractedNotes = extractNotes(notes || undefined)
    console.log(`📝 Extracted ${extractedNotes.length} notes from input`)
    if (extractedNotes.length > 0) {
      console.log('First 3 notes:', extractedNotes.slice(0, 3))
    }

    // Build photo contexts - when notes exist, they drive the observations
    reportProgress(sessionId, 35, 'Processing notes...', 'notes', {
      total: images.length
    })

    // Simple sequential mapping: photos provide visual evidence for notes
    const photoToNoteMapping = new Map<number, number>()
    const photoContexts: PhotoContext[] = []

    for (let i = 0; i < images.length; i++) {
      const originalName = images[i]?.originalName || `photo-${i + 1}`
      const hint = generateHintFromFilename(originalName)

      photoContexts.push({
        photoNumber: i + 1,
        originalName,
        hint,
        noteIndex: undefined, // Photos don't map to specific notes
        note: undefined
      })
    }

    reportProgress(sessionId, 45, 'Photos matched, analyzing content...', 'images', {
      processed: images.length,
      total: fileEntries.length
    })

    // Step 2: Simple AI call with adaptive chunking
    console.log('Calling AI...')
    reportProgress(sessionId, 50, 'Analyzing images with Gemini...', 'analysis', {
      total: images.length
    })

    const simpleResult = await runSimpleAnalysis({
      images,
      project: project as Project,
      notificationDate,
      notes: notes || undefined,
      sessionId: sessionId || undefined,
      photoContexts,
      extractedNotes
    })

    let analysisMode: 'simple' | 'chunked' | 'analyze'
    let sourceObservations: any[] | undefined
    let currentPhotoContexts: PhotoContext[] | undefined = photoContexts

    if (simpleResult) {
      analysisMode = simpleResult.mode
      sourceObservations = simpleResult.observations
    } else {
      console.warn('Chunked analysis failed, attempting single-photo analysis...')

      const singleObservations = await runSinglePhotoAnalysis({
        images,
        project: project as Project,
        notificationDate,
        notes: notes || undefined,
        sessionId: sessionId || undefined,
        photoContexts
      })

      if (singleObservations && singleObservations.length === images.length) {
        analysisMode = 'chunked'
        sourceObservations = singleObservations
      } else {
        console.warn('Single-photo analysis failed, falling back to batch analyzer.')

        reportProgress(sessionId, 60, 'Retrying with comprehensive analysis...', 'analysis', {
          processed: 0,
          total: images.length
        })

        const { observations: fallbackObservations, failed: fallbackFailed } = await analyzeImages({
          images,
          project: project as Project,
          notes: notes || undefined,
          sessionId: sessionId || undefined
        })

        analysisMode = 'analyze'
        sourceObservations = fallbackObservations
        currentPhotoContexts = photoContexts  // Use already-matched contexts
        failed.push(...fallbackFailed)
      }
    }

    if (!sourceObservations || sourceObservations.length === 0) {
      throw new Error('AI analysis produced no observations')
    }

    if (analysisMode !== 'analyze' && currentPhotoContexts) {
      sourceObservations = sourceObservations.map((obs, index) =>
        enrichObservationWithContext(obs, currentPhotoContexts?.[index])
      )
    }

    let observations = analysisMode === 'analyze'
      ? (sourceObservations as Observation[])
      : (sourceObservations as any[]).map(obs =>
          normalizeObservation(obs, project as Project, notificationDate)
        )

    if (analysisMode !== 'analyze' && hasDuplicateObservations(observations)) {
      console.warn('Duplicate observations detected after simple analysis. Attempting single-photo refinement...')

      const refinedObservations = await runSinglePhotoAnalysis({
        images,
        project: project as Project,
        notificationDate,
        notes: notes || undefined,
        sessionId: sessionId || undefined,
        photoContexts
      })

      if (refinedObservations && refinedObservations.length === images.length) {
        sourceObservations = refinedObservations
        observations = refinedObservations.map(obs =>
          normalizeObservation(obs, project as Project, notificationDate)
        )
        analysisMode = 'chunked'
      }
    }

    if (analysisMode !== 'analyze' && hasDuplicateObservations(observations)) {
      console.warn('Duplicate observations persist. Falling back to batch analyzer.')

      reportProgress(sessionId, 62, 'Re-running analysis to remove duplicates...', 'analysis', {
        processed: 0,
        total: images.length
      })

      const { observations: fallbackObservations, failed: fallbackFailed } = await analyzeImages({
        images,
        project: project as Project,
        notes: notes || undefined,
        sessionId: sessionId || undefined
      })

      analysisMode = 'analyze'
      sourceObservations = fallbackObservations
      observations = fallbackObservations
      currentPhotoContexts = photoContexts  // Use already-matched contexts
      failed.push(...fallbackFailed)

      console.warn('Batch analyzer fallback produced', observations.length, 'observations')
    }

    const rawObservations = analysisMode === 'analyze'
      ? sourceObservations.map((_, index) => ({ photo_index: index + 1 }))
      : (sourceObservations as any[])

    const observationImageMatches = mapObservationImages(rawObservations, observations, images, currentPhotoContexts || photoContexts)

    reportProgress(sessionId, 75, 'Applying project rules...', 'analysis', {
      processed: observations.length,
      total: images.length
    })

    if (analysisMode === 'analyze') {
      console.log(`Got ${observations.length} observations from batch analyzer fallback`)
    } else if (analysisMode === 'chunked') {
      // Got ${observations.length} observations from chunked simple AI retry
    } else {
      console.log(`Got ${observations.length} observations from simple AI response`)
    }

    if (mode === 'review') {
      const tokenToImage: Record<string, ProcessedImage> = {}
      const observationImageSummaries: Array<Array<{ token: string; originalIndex: number; originalName: string; mimeType: string }>> = []

      const observationsWithMeta: ObservationDraft[] = observations.map((obs, i) => {
        const imageMatch = observationImageMatches[i]
        const { images: matchedImages } = imageMatch
        const tokens: string[] = []
        const summaries: Array<{ token: string; originalIndex: number; originalName: string; mimeType: string }> = []

        matchedImages.forEach((image) => {
          const token = sessionId ? `${sessionId}:${randomUUID()}` : randomUUID()
          tokens.push(token)
          tokenToImage[token] = image
          summaries.push({
            token,
            originalIndex: image.originalIndex,
            originalName: image.originalName,
            mimeType: image.mimeType
          })
        })

        if (tokens.length === 0 && images[i]) {
          const fallbackToken = sessionId ? `${sessionId}:${randomUUID()}` : randomUUID()
          const fallbackImage = images[i]
          tokenToImage[fallbackToken] = fallbackImage
          tokens.push(fallbackToken)
          summaries.push({
            token: fallbackToken,
            originalIndex: fallbackImage.originalIndex,
            originalName: fallbackImage.originalName,
            mimeType: fallbackImage.mimeType
          })
        }

        observationImageSummaries.push(summaries)

        return {
          ...obs,
          __photoToken: tokens[0],
          __photoTokens: tokens
        }
      })

      if (sessionId) {
        const orderedTokens = observationImageSummaries.flatMap(summaryList => summaryList.map(summary => summary.token))
        setSessionData(sessionId, {
          projectFallback: project as Project,
          failed,
          images: tokenToImage,
          order: orderedTokens,
          observations: observationsWithMeta.map(({ __photoToken, __photoTokens, ...rest }) => rest)
        })
      }

      reportProgress(sessionId, 93, 'Preparing review data...', 'export', {
        processed: observations.length,
        total: images.length
      })
      reportProgress(sessionId, 100, 'Analysis complete', 'completed', {
        processed: observations.length,
        total: images.length
      })
      scheduleProgressClose(sessionId)

      // Return JSON for review
      return new Response(JSON.stringify({
        observations: observationsWithMeta,
        images: observationImageSummaries,
        failed,
        project,
        sessionId,
        totalImages: images.length,
        processedImages: observationImageSummaries.reduce((sum, imageList) => sum + imageList.length, 0)
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    } else {
      // Return ZIP
      console.log('Creating ZIP...')
      reportProgress(sessionId, 90, 'Preparing ZIP export...', 'export', {
        processed: observations.length,
        total: images.length
      })
      const { archive } = createZipStream({
        observations,
        images: images,
        project: project as Project,
        failed
      })

      const zipBuffer = await streamZipToBuffer(archive)

      reportProgress(sessionId, 100, 'Export ready', 'completed', {
        processed: observations.length,
        total: images.length
      })
      scheduleProgressClose(sessionId)

      return new Response(zipBuffer as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="enablon-observations-${project.toLowerCase()}-${new Date().toISOString().split('T')[0]}.zip"`,
          'Content-Length': zipBuffer.length.toString()
        }
      })
    }

  } catch (error) {
    console.error('Simple API Error:', error)

    const status = typeof (error as any)?.status === 'number' ? (error as any).status : 500
    const message = error instanceof Error ? error.message : 'Unknown error'

    reportProgress(sessionId, 100, `Processing failed: ${message}`, 'error')
    scheduleProgressClose(sessionId)

    return new Response(
      JSON.stringify({
        error: 'Processing failed',
        message,
        status
      }),
      {
        status,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
}
