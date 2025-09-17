import type { ProcessedImage, Observation, FailedItem } from '../types'
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

// Import sendProgressUpdate from progress manager
import { sendProgressUpdate } from '../progress/manager'

interface AnalyzeImagesInput {
  images: ProcessedImage[]
  project: Project
  notes?: string
  sessionId?: string
  allProjects?: Project[]
}

export async function analyzeImages({ 
  images, 
  project, 
  notes,
  sessionId,
  allProjects
}: AnalyzeImagesInput): Promise<{
  observations: Observation[]
  failed: FailedItem[]
}> {
  const observations: Observation[] = []
  const failed: FailedItem[] = []
  
  // Process images in micro-batches
  const batchSize = CONSTANTS.AI_BATCH_SIZE
  const batches: ProcessedImage[][] = []
  
  for (let i = 0; i < images.length; i += batchSize) {
    batches.push(images.slice(i, i + batchSize))
  }
  
  // Process batches with concurrency limit
  const concurrency = CONSTANTS.AI_CONCURRENCY
  const results = await Promise.all(
    batches.map((batch, batchIndex) => 
      processBatch(batch, project, notes, batchIndex, sessionId, batches.length, allProjects)
    )
  )
  
  // Flatten results and maintain original order
  for (const result of results) {
    observations.push(...result.observations)
    failed.push(...result.failed)
  }
  
  return { observations, failed }
}

// Helper function to count numbered notes in inspector notes
function countNumberedNotes(notes?: string): number {
  if (!notes) return 0

  // Match patterns like "1.", "2.", "3." etc. at the start of lines
  const numberedMatches = notes.match(/^\d+\./gm)
  return numberedMatches ? numberedMatches.length : 0
}

async function processBatch(
  batch: ProcessedImage[],
  project: Project,
  notes: string | undefined,
  batchIndex: number,
  sessionId?: string,
  totalBatches?: number,
  allProjects?: Project[]
): Promise<{ observations: Observation[], failed: FailedItem[] }> {
  try {
    // Send progress update for batch processing
    if (sessionId && totalBatches) {
      const progressPercent = 40 + (batchIndex / totalBatches) * 40 // 40-80% range for AI processing
      sendProgressUpdate(sessionId, {
        id: sessionId,
        progress: Math.round(progressPercent),
        label: `AI analyzing batch ${batchIndex + 1} of ${totalBatches}...`,
        step: 'ai_processing',
        details: { 
          batchIndex: batchIndex + 1, 
          totalBatches,
          processed: batchIndex * CONSTANTS.AI_BATCH_SIZE,
          total: totalBatches * CONSTANTS.AI_BATCH_SIZE
        }
      })
    }

    const prompt = buildAIPrompt(project, notes, allProjects)
    const imageDataUrls = batch.map(img => 
      `data:${img.mimeType};base64,${img.buffer.toString('base64')}`
    )
    
    const response = await callOpenRouterAPI(prompt, imageDataUrls)
    console.log(`Raw AI response for batch ${batchIndex}:`, response)
    
    // Strip markdown code blocks if present
    let cleanResponse = response.trim()
    if (cleanResponse.startsWith('```json')) {
      cleanResponse = cleanResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '')
    } else if (cleanResponse.startsWith('```')) {
      cleanResponse = cleanResponse.replace(/^```\s*/, '').replace(/\s*```$/, '')
    }
    
    let rawObservations
    try {
      rawObservations = JSON.parse(cleanResponse)
      console.log(`Parsed ${rawObservations.length} observations from AI response`)
    } catch (parseError) {
      console.error(`JSON parse error for batch ${batchIndex}:`, parseError)
      console.error('Cleaned response that failed to parse:', cleanResponse)
      throw new Error(`Failed to parse AI response as JSON: ${parseError}`)
    }
    
    if (!Array.isArray(rawObservations)) {
      console.error(`AI response is not an array for batch ${batchIndex}:`, rawObservations)
      throw new Error(`AI returned non-array response`)
    }
    
    // Validate observation count against numbered notes
    const expectedObservations = countNumberedNotes(notes)
    console.log(`AI returned ${rawObservations.length} observations for ${batch.length} images in batch ${batchIndex}`)

    if (expectedObservations > 0) {
      console.log(`Expected ${expectedObservations} observations based on numbered notes`)
      if (rawObservations.length > expectedObservations) {
        console.warn(`Warning: AI created ${rawObservations.length} observations but notes only contain ${expectedObservations} numbered items. Taking first ${expectedObservations} observations.`)
        // Truncate to match expected count
        rawObservations = rawObservations.slice(0, expectedObservations)
      }
    } else if (rawObservations.length !== batch.length) {
      console.warn(`AI returned ${rawObservations.length} observations for ${batch.length} images`)
    }
    
    // Validate and repair each observation
    const observations: Observation[] = []
    const failed: FailedItem[] = []
    
    for (let i = 0; i < batch.length; i++) {
      try {
        const repaired = validateAndRepairObservation(rawObservations[i], project, allProjects)
        observations.push(repaired)
      } catch (error) {
        failed.push({
          originalFilename: batch[i].originalName,
          reason: `AI analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          step: 'ai_analysis'
        })
      }
    }
    
    return { observations, failed }
    
  } catch (error) {
    // If entire batch fails, mark all images as failed
    const batchFailed: FailedItem[] = batch.map(img => ({
      originalFilename: img.originalName,
      reason: `Batch ${batchIndex} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      step: 'ai_analysis'
    }))
    
    return { observations: [], failed: batchFailed }
  }
}

function buildAIPrompt(project: Project, notes?: string, allProjects?: Project[]): string {
  const notificationDate = getStockholmDate()
  
  return `Role: construction safety inspector producing Compass/Enablon rows

MANDATORY FIRST STEP: If inspector notes contain numbered items (1, 2, 3, etc.), count them. Your output must contain EXACTLY that many observations - never more.

CRITICAL ANALYSIS INSTRUCTIONS:
- Create professional, contractor-ready observations suitable for direct sending to subcontractors/GCs
- Use the inspector's notes to group related photos into single observations where appropriate
- NEVER mention "image", "photo", "visible", "observed", or "The image shows" - write direct statements
- Write concise, actionable descriptions focusing on the safety issue and location
- If inspector notes indicate multiple photos for same issue, create ONE observation referencing multiple photos
- Output: STRICT JSON array; one object per UNIQUE safety issue; no extra fields; British English

Timezone: Europe/Stockholm; Notification Date = ${notificationDate}

${allProjects && allProjects.length > 1 ? `
MULTI-PROJECT ANALYSIS:
Available Projects: ${allProjects.join(', ')}
Primary Project: ${project}

CRITICAL: For each observation, determine the appropriate project code based on the context from the notes and image content. Use ONLY the specific project codes (${allProjects.join(', ')}) that matches the location/issue shown in each photo.

IMPORTANT: Do NOT confuse building areas with project names:
- COLO1, COLO2, CELL1, CELL2 etc. are building areas/rooms (use "COLO or AZ" for Room/Area field)
- Only valid project codes are: ${allProjects.join(', ')}` : `Project: ${project}

IMPORTANT: Do NOT confuse building areas with project names:
- COLO1, COLO2, CELL1, CELL2 etc. are building areas/rooms (use "COLO or AZ" for Room/Area field)
- Only valid project code is: ${project}`}
${notes ? `
CONTEXT NOTES FROM SAFETY INSPECTOR:
${notes}

CRITICAL GROUPING REQUIREMENT: Count the numbered items in the notes below. Create EXACTLY that many observations.
Example: Notes contain items 1-13 → Output exactly 13 observations (never 15, never more than the note count)

CRITICAL: Use these inspector notes as the PRIMARY SOURCE for observations. Match each numbered note to photos:
- ONE numbered note = ONE observation (even if multiple photos show the same issue)
- If multiple photos relate to one numbered note, create ONE observation covering all photos
- Use the exact location details from notes (e.g., "COLO3 CELL1", "Externals South")
- Include contractor names when mentioned (e.g., "Jones Engineering", "Salboheds")
- Use the inspector's description as the basis, don't rewrite their findings
- Professional tone suitable for direct contractor communication${allProjects && allProjects.length > 1 ? ' Pay special attention project-specific mentions and assign observations to the correct project.' : ''}` : ''}

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
- Project field must ONLY contain valid project codes (${allProjects ? allProjects.join(', ') : project}) - NOT building areas like COLO1, CELL1, etc.

CORRECTIVE ACTIONS - TWO DIFFERENT FIELDS:

INTERIM CORRECTIVE ACTIONS (immediate actions taken on-site):
- What was ACTUALLY DONE during the inspection by inspector/GC/contractors
- Use past tense describing completed immediate actions
- If nothing was done immediately, use "N/A"
- Focus on actions taken to temporarily secure, stop work, remove hazards, barricade
- Examples:
  * "Area barricaded and workers removed from unsafe zone during inspection"
  * "Broken ladder removed from site immediately by contractor"
  * "Generator use stopped and area secured with warning signs"
  * "N/A" (if no immediate action was taken during inspection)

FINAL CORRECTIVE ACTIONS (permanent long-term solutions):
- What needs to happen to PERMANENTLY fix the root cause
- Start with status: "OPEN - GC to action" or "CLOSED"
- Focus on training, procedures, equipment replacement, system improvements
- Examples:
  * "OPEN - GC to action: Install permanent earthing system for all generators and provide electrical safety training"
  * "OPEN - GC to action: Replace with compliant ladder and update tool approval list"
  * "CLOSED: Continue to reinforce this good practice across all contractors"

IMPORTANT: These are DIFFERENT actions:
- INTERIM = What was DONE on the spot (past tense, completed actions)
- FINAL = What NEEDS to be done later (future actions with OPEN/CLOSED status)

QUICK CATEGORIZATION:
- PPE violations (missing glasses, shorts, wrong footwear) → General: Personal Protective Equipment
- Smoking on site → General: Safety Culture  
- AED/Emergency equipment present → Positive Observation
- Broken pallets/damaged materials → General: Housekeeping
- Traffic/vehicle issues → General: Site Access and Control
- Cable drum without chocks → HRA: Material Handling
- Rebar without caps → General: Walking, Working Surfaces
- Barriers down/broken → General: Barricades

PROFESSIONAL WRITING REQUIREMENTS:
- Write like a construction safety professional communicating with contractors
- Use direct, clear language that requires no editing before sending to subcontractors
- Avoid unnecessary words: "appears to be", "seems to", "potentially", "could be"
- Never use: "image", "photo", "visible", "observed", "The image shows", "can be seen"
- Write statements as facts: "Scaffolding materials stored on North Spine Road" not "Materials are observed to be stored"
- Include specific locations from inspector notes: exact COLO areas, room numbers, contractor names
- Keep descriptions concise but complete - ready for immediate contractor action

PHOTO-CONTEXT MATCHING ALGORITHM:
CRITICAL: The number of observations MUST match the number of numbered notes from the inspector.

STEP 1: Count the numbered notes (e.g., if notes contain items 1-13, create exactly 13 observations)
STEP 2: For each numbered note, identify ALL photos that relate to that specific issue
STEP 3: Create ONE observation per numbered note, even if multiple photos show the same issue
STEP 4: If there are more photos than notes, the extra photos likely show additional angles of existing issues

GROUPING RULES:
- Inspector note "1. PPE violation in COLO3" + 2 photos of same worker = 1 observation
- Inspector note "2. Scaffolding issue" + 1 photo = 1 observation
- Inspector note "3. Housekeeping concern" + 3 photos of same area = 1 observation
- Result: 3 numbered notes = exactly 3 observations (not 6)

MANDATORY: If inspector provides 13 numbered notes, output exactly 13 observations. Never create more observations than numbered notes.

Return exactly 15 fields per object matching these headers:
Project, Room/Area, Comments, Observation Category, Observation Description, Responsible Party, Interim Corrective Actions, Final Corrective Actions, Category Type, Phase of Construction, Notification Date, High Risk + Significant Exposure, General Category, Worst Potential Severity, Person Notified

Return only JSON: [ {15-field object}, ... ]`
}

async function callOpenRouterAPI(prompt: string, imageDataUrls: string[]): Promise<string> {
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
  
  console.log(`Calling OpenRouter API with ${imageDataUrls.length} images`)
  
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
      messages,
      temperature: 0.2
    })
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
  console.log('AI response preview:', content?.substring(0, 200) + '...')
  
  return content
}

function validateAndRepairObservation(raw: any, defaultProject: Project, allProjects?: Project[]): Observation {
  const notificationDate = getStockholmDate()
  
  // Determine the project to use - prefer AI's choice if it's valid
  let projectToUse = defaultProject
  if (allProjects && allProjects.length > 1 && raw['Project']) {
    const aiProject = raw['Project'] as string
    if (allProjects.includes(aiProject as Project)) {
      projectToUse = aiProject as Project
    }
  }
  
  const projectMappings = PROJECT_MAPPINGS[projectToUse]
  
  // Start with defaults
  const observation: Observation = {
    'Project': projectToUse,
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