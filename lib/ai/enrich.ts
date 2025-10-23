/**
 * AI enrichment for single observations with assigned photos
 * Used in photo assignment workflow
 */

import type { ProcessedImage, Observation, FailedItem } from '../types'
import type { Project } from '../constants/enums'
import {
  CONSTANTS,
  PROJECTS,
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
import { normalizeProjectForOutput } from '../utils/projectDetection'

interface EnrichObservationInput {
  noteText: string
  photos: ProcessedImage[]
  project: Project
  observationNumber: number
}

const ENRICHMENT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    Project: {
      type: 'string',
      enum: Array.from(PROJECTS)
    },
    'Room/Area': {
      type: 'string',
      enum: Array.from(ROOM_AREAS)
    },
    Comments: {
      type: 'string',
      enum: [CONSTANTS.COMMENTS]
    },
    'Observation Category': {
      type: 'string',
      enum: Array.from(OBSERVATION_CATEGORIES)
    },
    'Observation Description': {
      type: 'string'
    },
    'Responsible Party': {
      type: 'string'
    },
    'Interim Corrective Actions': {
      type: 'string'
    },
    'Final Corrective Actions': {
      type: 'string'
    },
    'Category Type': {
      type: 'string',
      enum: Array.from(CATEGORY_TYPES)
    },
    'Phase of Construction': {
      type: 'string',
      enum: Array.from(CONSTRUCTION_PHASES)
    },
    'Notification Date': {
      type: 'string'
    },
    'High Risk + Significant Exposure': {
      type: 'string',
      enum: [''].concat(Array.from(HRA_CATEGORIES))
    },
    'General Category': {
      type: 'string',
      enum: [''].concat(Array.from(GENERAL_CATEGORIES))
    },
    'Worst Potential Severity': {
      type: 'string',
      enum: Array.from(SEVERITY_LEVELS)
    },
    'Person Notified': {
      type: 'string'
    }
  },
  required: [
    'Project',
    'Room/Area',
    'Comments',
    'Observation Category',
    'Observation Description',
    'Responsible Party',
    'Interim Corrective Actions',
    'Final Corrective Actions',
    'Category Type',
    'Phase of Construction',
    'Notification Date',
    'High Risk + Significant Exposure',
    'General Category',
    'Worst Potential Severity',
    'Person Notified'
  ]
} as const

export async function enrichObservation({
  noteText,
  photos,
  project,
  observationNumber
}: EnrichObservationInput): Promise<{
  observation: Observation | null
  failed: FailedItem | null
}> {
  try {
    console.log(`Enriching observation #${observationNumber} with ${photos.length} photo(s)`)
    console.log(`Note: "${noteText}"`)

    const prompt = buildEnrichmentPrompt(project, noteText, observationNumber)
    const imageDataUrls = photos.map(img =>
      `data:${img.mimeType};base64,${img.buffer.toString('base64')}`
    )

    const response = await callOpenRouterAPI(prompt, imageDataUrls, { schema: ENRICHMENT_RESPONSE_SCHEMA })
    console.log(`Raw AI response for observation #${observationNumber}:`, response)

    let rawObservation
    try {
      rawObservation = JSON.parse(response.trim())
      console.log(`Parsed observation #${observationNumber} from AI response`)
    } catch (parseError) {
      console.error(`JSON parse error for observation #${observationNumber}:`, parseError)
      console.error('Response that failed to parse:', response)

      // Fallback to legacy cleaning in case schema enforcement was ignored
      let fallback = response.trim()
      if (fallback.startsWith('```json')) {
        fallback = fallback.replace(/^```json\s*/, '').replace(/\s*```$/, '')
      } else if (fallback.startsWith('```')) {
        fallback = fallback.replace(/^```\s*/, '').replace(/\s*```$/, '')
      }

      rawObservation = JSON.parse(fallback)
      console.log(`Parsed observation #${observationNumber} using fallback cleaning`)
    }

    // AI should return a single object, but might return an array with one item
    const obsData = Array.isArray(rawObservation) ? rawObservation[0] : rawObservation

    if (!obsData) {
      throw new Error('AI returned empty response')
    }

    // Validate and repair the observation
    const observation = validateAndRepairObservation(obsData, project, noteText)

    return { observation, failed: null }

  } catch (error) {
    console.error(`Failed to enrich observation #${observationNumber}:`, error)
    return {
      observation: null,
      failed: {
        originalFilename: `observation_${observationNumber}`,
        reason: `Enrichment failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        step: 'ai_enrichment'
      }
    }
  }
}

function buildEnrichmentPrompt(project: Project, noteText: string, observationNumber: number): string {
  const notificationDate = getStockholmDate()

  return `Role: construction safety inspector producing a Compass/Enablon observation row

TASK: Create ONE observation for this safety issue using the inspector's note and assigned photo(s).

Inspector Note #${observationNumber}:
${noteText}

Timezone: Europe/Stockholm; Notification Date = ${notificationDate}
Project: ${project}

IMPORTANT: Do NOT confuse building areas with project names:
- COLO1, COLO2, CELL1, CELL2 etc. are building areas/rooms (use "COLO or AZ" for Room/Area field)
- Only valid project code is: ${project}

PROFESSIONAL WRITING REQUIREMENTS:
- Write like a construction safety professional communicating with contractors
- Use direct, clear language ready for contractor communication
- NEVER use: "image", "photo", "visible", "observed", "The image shows", "can be seen"
- Write statements as facts about the safety issue

MANDATORY LOCATION PRESERVATION:
The location from the note MUST appear at the START of your Observation Description.

Format: "Location: Safety issue description"

Examples of CORRECT descriptions:
✓ "COLO3: Materials leaning against columns, which may fall"
✓ "Battery room 02: Rebars holding earthing cables without caps"
✓ "COLO2: Jones Engineering operatives lifting a busbar with unclear method"

Examples of WRONG descriptions (DO NOT DO THIS):
✗ "Materials leaning against columns" (location missing!)
✗ "Rebars holding cables without caps" (location missing!)

OBSERVATION QUALITY - PHOTO ENRICHMENT:

GOOD photo enrichment (adds safety value):
✅ Equipment brands/models: "AMIRENT MEWP", "Kirby ladder"
✅ Asset tags/IDs: "E16 bin", "KE6522 ladder", "FP11 fire point"
✅ Specific dates: "expired 23.08.2025"
✅ Contractor names: "Jones Engineering", "Salboheds", "DVS"
✅ Equipment types: "SWA cable", "extension reel cable"
✅ Technical details: "earthing system", "busbar"

BAD photo description (no safety value):
❌ Colors: "blue bin", "orange barrier", "red barriers"
❌ Visual narrative: "visibly flat", "clearly visible"
❌ Spatial positions: "next to excavator", "nearby"
❌ Photo descriptions: "the photo shows", "can be seen in image"

ENRICHMENT DECISION FRAMEWORK:
Ask: "Does this detail help identify, track, or fix the hazard?"
- Equipment ID "KE6522 ladder" → YES (helps track specific asset)
- Color "blue ladder" → NO (doesn't help track or fix)
- Date "expired 23.08.2025" → YES (shows non-compliance)
- Position "next to wall" → NO (doesn't help fix issue)

Use only these enumerations:

Room/Area: ${ROOM_AREAS.join(', ')}

Observation Category: ${OBSERVATION_CATEGORIES.join(', ')}

Category Type: ${CATEGORY_TYPES.join(', ')}

HRA + Significant Exposure: ${HRA_CATEGORIES.join(', ')}

General Category: ${GENERAL_CATEGORIES.join(', ')}

Phase of Construction: ${CONSTRUCTION_PHASES.join(', ')}

Worst Potential Severity: ${SEVERITY_LEVELS.join(', ')}

CRITICAL RULES:
- If Category Type = "HRA + Significant Exposure" → populate High Risk field, leave General Category empty
- If Category Type = "General Category" → populate General Category, leave High Risk field empty
- Project field must be: ${project} (NOT building areas like COLO1, CELL1, etc.)

CORRECTIVE ACTIONS - TWO DIFFERENT FIELDS:

INTERIM CORRECTIVE ACTIONS (immediate actions taken on-site):
- What was ACTUALLY DONE during the inspection
- Use past tense describing completed immediate actions
- If nothing was done immediately, use "N/A"
- Examples:
  * "Area barricaded and workers removed during inspection"
  * "Broken ladder removed from site immediately"
  * "N/A"

FINAL CORRECTIVE ACTIONS (permanent long-term solutions):
- What needs to happen to PERMANENTLY fix the root cause
- Start with status: "OPEN - GC to action" or "CLOSED"
- Examples:
  * "OPEN - GC to action: Install permanent earthing system and provide electrical safety training"
  * "CLOSED: Continue to reinforce this good practice across all contractors"

QUICK CATEGORIZATION:
- PPE violations → General: Personal Protective Equipment
- Smoking on site → General: Safety Culture
- AED/Emergency equipment → Positive Observation
- Broken pallets/damaged materials → General: Housekeeping
- Traffic/vehicle issues → General: Site Access and Control
- Cable drum without chocks → HRA: Material Handling
- Rebar without caps → General: Walking, Working Surfaces
- Barriers down/broken → General: Barricades

Return exactly 15 fields in this JSON object:
{
  "Project": "${project}",
  "Room/Area": "...",
  "Comments": "New observation - Photo evidence attached",
  "Observation Category": "...",
  "Observation Description": "...",
  "Responsible Party": "...",
  "Interim Corrective Actions": "...",
  "Final Corrective Actions": "...",
  "Category Type": "...",
  "Phase of Construction": "...",
  "Notification Date": "${notificationDate}",
  "High Risk + Significant Exposure": "...",
  "General Category": "...",
  "Worst Potential Severity": "...",
  "Person Notified": "..."
}

Return only the JSON object.`
}

async function callOpenRouterAPI(
  prompt: string,
  imageDataUrls: string[],
  options?: { schema?: object }
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable is required')
  }

  const messages = [
    {
      role: 'user' as const,
      content: [
        { type: 'text' as const, text: prompt },
        ...imageDataUrls.map(url => ({
          type: 'image_url' as const,
          image_url: url
        }))
      ]
    }
  ]

  console.log(`Calling OpenRouter API with ${imageDataUrls.length} image(s)`)

  const body: Record<string, any> = {
    model: 'google/gemini-2.5-flash',
    messages,
    temperature: 0.2
  }

  if (options?.schema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: 'enablon_observation',
        schema: options.schema
      }
    }
    body.response_mime_type = 'application/json'
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.OPENROUTER_APP_URL || '',
      'X-Title': process.env.OPENROUTER_APP_NAME || 'Enablon Observation Bundler'
    },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`OpenRouter API error: ${response.status} ${response.statusText}`)
    console.error('Error response:', errorText)
    throw new Error(`OpenRouter API error: ${response.status} ${response.statusText} - ${errorText}`)
  }

  const data = await response.json()
  console.log('OpenRouter API response received successfully')

  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    console.error('Invalid API response structure:', JSON.stringify(data, null, 2))
    throw new Error('Invalid API response structure')
  }

  const content = data.choices[0].message.content
  console.log('AI response content length:', content?.length || 0)

  return content
}

function validateAndRepairObservation(raw: any, project: Project, noteText?: string): Observation {
  const notificationDate = getStockholmDate()
  const projectMappings = PROJECT_MAPPINGS[project]

  // Start with defaults
  const outputProject = normalizeProjectForOutput(project)

  const observation: Observation = {
    'Project': outputProject,
    'Room/Area': validateEnum(raw['Room/Area'], ROOM_AREAS, 'Other'),
    'Comments': CONSTANTS.COMMENTS,
    'Observation Category': validateEnum(raw['Observation Category'], OBSERVATION_CATEGORIES, 'New At Risk Observation'),
    'Observation Description': String(raw['Observation Description'] || 'Safety observation identified'),
    'Responsible Party': projectMappings.responsibleParty,
    'Interim Corrective Actions': String(raw['Interim Corrective Actions'] || ''),
    'Final Corrective Actions': String(raw['Final Corrective Actions'] || ''),
    'Category Type': validateEnum(raw['Category Type'], CATEGORY_TYPES, 'General Category'),
    'Phase of Construction': validateEnum(raw['Phase of Construction'], CONSTRUCTION_PHASES, 'Commissioning'),
    'Notification Date': notificationDate,
    'High Risk + Significant Exposure': '',
    'General Category': '',
    'Worst Potential Severity': validateEnum(raw['Worst Potential Severity'], SEVERITY_LEVELS, 'Minor (7 Days)'),
    'Person Notified': projectMappings.personNotified
  }

  // Enforce exclusivity rule
  if (observation['Category Type'] === 'HRA + Significant Exposure') {
    observation['High Risk + Significant Exposure'] = validateEnum(
      raw['High Risk + Significant Exposure'],
      HRA_CATEGORIES,
      'Material Handling'
    )
    observation['General Category'] = ''
  } else {
    observation['General Category'] = validateEnum(
      raw['General Category'],
      GENERAL_CATEGORIES,
      'Other'
    )
    observation['High Risk + Significant Exposure'] = ''
  }

  applyClosureRules(observation, noteText)

  return observation
}

function validateEnum<T extends readonly string[]>(
  value: any,
  validValues: T,
  defaultValue: T[number]
): T[number] {
  if (typeof value === 'string' && validValues.includes(value as T[number])) {
    return value as T[number]
  }
  return defaultValue
}

function applyClosureRules(observation: Observation, noteText?: string) {
  const finalText = observation['Final Corrective Actions']?.trim() || ''

  if (/^closed\b/i.test(finalText)) {
    return
  }

  const combined = `${noteText || ''} ${observation['Interim Corrective Actions'] || ''}`.toLowerCase()
  const closurePatterns = [
    'addressed on the spot',
    'fixed on the spot',
    'resolved on the spot',
    'resolved immediately',
    'rectified on the spot',
    'resolved during inspection',
    'closed during inspection',
    'issue corrected immediately'
  ]

  const shouldClose = closurePatterns.some(pattern => combined.includes(pattern))
  if (!shouldClose) {
    return
  }

  let closureMessage = ''
  if (noteText) {
    const sentenceMatch = noteText.match(/[^.!?]*addressed on the spot[^.!?]*[.!?]?/i)
    if (sentenceMatch?.[0]) {
      closureMessage = sentenceMatch[0].replace(/\s+/g, ' ').trim()
    }
  }

  if (!closureMessage && finalText) {
    closureMessage = finalText.replace(/^open\s*-?\s*gc\s*to\s*action:\s*/i, '').trim()
  }

  if (!closureMessage) {
    closureMessage = 'Issue addressed on the spot during inspection.'
  }

  closureMessage = closureMessage.replace(/^closed[:\s-]*/i, '').trim()

  observation['Final Corrective Actions'] = `CLOSED: ${closureMessage}`
}
