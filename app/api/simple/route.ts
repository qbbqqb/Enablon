import { NextRequest } from 'next/server'
import { randomUUID } from 'crypto'
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

export const runtime = 'nodejs'
export const maxDuration = 300

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

  return observation
}

async function callSimpleAI(
  images: any[],
  project: Project,
  notificationDate: string,
  notes?: string
): Promise<Observation[]> {
  console.log(`Calling AI with ${images.length} images and ${notes?.length || 0} chars of notes`)

  const prompt = `You are a construction safety inspector creating Enablon/Compass observations.

INPUT CONTEXT:
- Project: ${project}
- Expected notification date (Europe/Stockholm): ${notificationDate}
- Images: ${images.length} photos supplied in the same order they must be referenced.
${notes ? `- Inspector notes (verbatim):
${notes}` : '- No inspector notes were provided.'}

OUTPUT REQUIREMENTS:
Return EXACTLY ${images.length} JSON objects inside a single array (no markdown, no commentary). Each object MUST use these exact keys and values from the allowed options:
- "Project": always "${project}".
- "Room/Area": choose the closest match from: ${ROOM_AREAS.join(', ')}.
- "Comments": use "${CONSTANTS.COMMENTS}".
- "Observation Category": choose from ${OBSERVATION_CATEGORIES.join(' | ')}.
- "Observation Description": concise, actionable summary of the condition.
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

EXCLUSIVITY RULES:
- If "Category Type" is "HRA + Significant Exposure", set "High Risk + Significant Exposure" and leave "General Category" empty.
- If "Category Type" is "General Category", set "General Category" and leave "High Risk + Significant Exposure" empty.

PHOTO PAIRING HELPERS (optional fields kept in JSON but not exported):
- "photo_index": 1-based index of the best matching photo.
- "photo_indices": array of 1-based indices if multiple photos apply.

Follow the inspector notes strictly. If the notes are numbered (1., 2., 3., etc.), produce the same number of observations and align each description with the corresponding numbered item. When the notes do not cite an issue, rely on the photo evidence.

Return only the JSON array.`

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
      // Project requirement: Gemini 2.5 Pro Vision on OpenRouter
      model: 'google/gemini-2.5-pro',
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
    console.error('Failed to parse AI response:', cleanContent)
    throw new Error(`Failed to parse AI response as JSON: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }

  if (!Array.isArray(observations)) {
    throw new Error('AI response is not an array of observations')
  }

  console.log(`AI returned ${observations.length} observations`)

  return observations
}

export async function POST(request: NextRequest) {
  let sessionId: string | undefined

  try {
    console.log('=== Simple API Started ===')

    // Parse form data
    const formData = await request.formData()
    const fdAny = formData as any
    const project = (fdAny.get('project') as string) || ''
    const notes = (fdAny.get('notes') as string) || ''
    const mode = request.headers.get('X-Mode') || 'zip'
    const potentialSessionId = fdAny.get('sessionId')
    if (typeof potentialSessionId === 'string') {
      sessionId = potentialSessionId
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

    reportProgress(sessionId, 35, 'Images ready for analysis', 'images', {
      processed: images.length,
      total: fileEntries.length
    })

    // Step 2: Simple AI call - no batching, no complex logic
    console.log('Calling AI...')
    reportProgress(sessionId, 50, 'Analyzing images with Gemini...', 'analysis', {
      total: images.length
    })
    const rawObservations: any[] = await callSimpleAI(
      images,
      project as Project,
      notificationDate,
      notes || undefined
    )

    console.log(`Got ${rawObservations.length} observations from AI`)

    reportProgress(sessionId, 75, 'Applying project rules...', 'analysis', {
      processed: rawObservations.length,
      total: images.length
    })

    const observations = rawObservations.map(obs =>
      normalizeObservation(obs, project as Project, notificationDate)
    )

    if (mode === 'review') {
      // Attempt to map each observation to the best matching photo based on
      // optional fields the model may include: photo_index (1-based) or
      // photo_indices (array). Fall back to same-index pairing.
      const selectedImages = rawObservations.map((obs: any, i: number) => {
        let idx: number | undefined
        if (typeof obs?.photo_index === 'number') idx = obs.photo_index - 1
        if (!idx && Array.isArray(obs?.photo_indices) && obs.photo_indices.length > 0) {
          const first = obs.photo_indices[0]
          if (typeof first === 'number') idx = first - 1
        }
        if (!idx && Array.isArray(obs?.photoIndexes) && obs.photoIndexes.length > 0) {
          const first = obs.photoIndexes[0]
          if (typeof first === 'number') idx = first - 1
        }
        if (typeof idx !== 'number' || idx < 0 || idx >= images.length) {
          idx = i
        }
        return images[idx]
      })

      const observationTokens = selectedImages.map(() =>
        sessionId ? `${sessionId}:${randomUUID()}` : randomUUID()
      )

      const observationsWithMeta: ObservationDraft[] = observations.map((obs, idx) => ({
        ...obs,
        __photoToken: observationTokens[idx]
      }))

      if (sessionId) {
        const imageRecord: Record<string, ProcessedImage> = {}
        observationTokens.forEach((token, idx) => {
          const image = selectedImages[idx]
          if (image) {
            imageRecord[token] = image
          }
        })

        setSessionData(sessionId, {
          project: project as Project,
          failed,
          images: imageRecord,
          order: observationTokens
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

      const imageSummaries = selectedImages.map((img, idx) => ({
        originalIndex: img.originalIndex,
        originalName: img.originalName,
        mimeType: img.mimeType,
        __photoToken: observationTokens[idx]
      }))

      // Return JSON for review
      return new Response(JSON.stringify({
        observations: observationsWithMeta,
        images: imageSummaries,
        failed,
        project,
        sessionId,
        totalImages: images.length,
        processedImages: observations.length
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
        images: images.slice(0, observations.length),
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
