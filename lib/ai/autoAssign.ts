/**
 * Lightweight AI photo assignment (no enrichment)
 * Just matches photos to observation notes, returns assignments
 */

import type { ProcessedImage } from '../types'
import type { ObservationShell } from '../notes/extractShells'

interface AutoAssignInput {
  images: ProcessedImage[]
  observationShells: ObservationShell[]
}

interface PhotoAssignment {
  observationId: number
  photoIndices: number[] // 1-based indices into images array
}

export async function autoAssignPhotos({
  images,
  observationShells
}: AutoAssignInput): Promise<Record<number, number[]>> {
  console.log(`🤖 Auto-assigning ${images.length} photos to ${observationShells.length} observations`)

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable is required')
  }

  // Build prompt for photo assignment
  const notesText = observationShells.map(shell => `${shell.id}. ${shell.fullNote}`).join('\n')

  const prompt = `You are a photo assignment assistant. Match photos to numbered observation notes.

NUMBERED OBSERVATION NOTES:
${notesText}

TASK: For each numbered note above, identify which photo(s) show that specific observation.

CRITICAL RULES:
1. Each photo can only be assigned to ONE observation
2. Each observation should have at least one photo
3. Match photos to notes based on location, equipment, people, and safety issue
4. If a note mentions "photos 1-3" or similar, assign those specific photos
5. Return ONLY a JSON array with this exact format:

[
  {"observationId": 1, "photoIndices": [1, 2]},
  {"observationId": 2, "photoIndices": [3]},
  ...
]

IMPORTANT:
- photoIndices are 1-based (first photo is 1, not 0)
- Every photo must be assigned exactly once
- If unsure, assign based on most likely match
- Total photos available: ${images.length}

Return ONLY the JSON array, no explanation.`

  // Convert images to data URLs
  const imageDataUrls = images.map(img =>
    `data:${img.mimeType};base64,${img.buffer.toString('base64')}`
  )

  console.log(`Calling AI with ${images.length} images and ${observationShells.length} notes`)

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
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            ...imageDataUrls.map(url => ({
              type: 'image_url',
              image_url: url
            }))
          ]
        }
      ],
      temperature: 0.1 // Low temperature for consistent assignments
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`OpenRouter API error: ${response.status}`)
    throw new Error(`AI assignment failed: ${response.status} - ${errorText}`)
  }

  const data = await response.json()
  const content = data.choices[0].message.content

  console.log('Raw AI assignment response:', content)

  // Parse response
  let cleanResponse = content.trim()
  if (cleanResponse.startsWith('```json')) {
    cleanResponse = cleanResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '')
  } else if (cleanResponse.startsWith('```')) {
    cleanResponse = cleanResponse.replace(/^```\s*/, '').replace(/\s*```$/, '')
  }

  let aiAssignments: PhotoAssignment[]
  try {
    aiAssignments = JSON.parse(cleanResponse)
  } catch (parseError) {
    console.error('Failed to parse AI assignment response:', cleanResponse)
    throw new Error('AI returned invalid assignment format')
  }

  // Convert to Record<obsId, photoId[]> format
  const assignments: Record<number, number[]> = {}
  for (const assignment of aiAssignments) {
    assignments[assignment.observationId] = assignment.photoIndices
  }

  // Validate assignments
  const totalAssigned = Object.values(assignments).flat().length
  console.log(`✅ AI assigned ${totalAssigned}/${images.length} photos`)

  // Log assignment summary
  for (const [obsId, photoIds] of Object.entries(assignments)) {
    console.log(`   Obs ${obsId}: ${photoIds.length} photo(s) - [${photoIds.join(', ')}]`)
  }

  return assignments
}
