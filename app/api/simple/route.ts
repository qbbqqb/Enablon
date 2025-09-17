import { NextRequest } from 'next/server'
import { PROJECTS } from '@/lib/constants/enums'
import type { Project } from '@/lib/constants/enums'
import { normalizeImages } from '@/lib/files/normalize'
import { buildCSV } from '@/lib/csv/buildCsv'
import { createZipStream, streamZipToBuffer } from '@/lib/zip/buildZip'
import type { Observation, FailedItem } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 300

async function callSimpleAI(images: any[], project: Project, notes?: string): Promise<Observation[]> {
  console.log(`Calling AI with ${images.length} images and ${notes?.length || 0} chars of notes`)

  const prompt = `You are a construction safety inspector creating Enablon/Compass observations.

${notes ? `INSPECTOR NOTES:
${notes}

INSTRUCTIONS: Create observations based on these notes and the photos. If the notes are numbered (1., 2., 3., etc.), create exactly that many observations.` : 'INSTRUCTIONS: Analyze the photos and create safety observations for what you see.'}

OUTPUT: Return ONLY a JSON array of observations. Each observation must have these exact fields:
- "Project": "${project}"
- "Room/Area": (e.g., "COLO or AZ", "External Area", "Loading Bay or Dock")
- "Comments": (brief context)
- "Observation Category": ("New At Risk Observation" or "New Positive Observation")
- "Observation Description": (clear, actionable description)
- "Responsible Party": (contractor name or "GC" or "")
- "Interim Corrective Actions": ("N/A" usually)
- "Final Corrective Actions": (action required, or "CLOSED:" for positive)
- "Category Type": ("General Category" or "HRA + Significant Exposure")
- "Phase of Construction": (relevant phase)
- "Notification Date": "17/09/2025"
- "High Risk + Significant Exposure": ("Electrical", "Working from Heights", "Lifting Operations", etc. or "")
- "General Category": ("Housekeeping", "Barricades", "Safety Culture", etc. or "")
- "Worst Potential Severity": ("Minor (7 Days)", "Potentially Serious/Serious (Immediate)", "Positive Observation")
- "Person Notified": ""

Return ONLY the JSON array, no markdown, no explanation.`

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
      // Use a generally available multimodal model. The previous
      // `gemini-2.0-flash-exp:free` route can return 404 (model not found).
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
    throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`)
  }

  const data = await response.json()
  const content = data.choices[0]?.message?.content || ''

  // Clean markdown formatting
  let cleanContent = content.trim()
  if (cleanContent.startsWith('```json')) {
    cleanContent = cleanContent.replace(/^```json\s*/, '').replace(/\s*```$/, '')
  } else if (cleanContent.startsWith('```')) {
    cleanContent = cleanContent.replace(/^```\s*/, '').replace(/\s*```$/, '')
  }

  const observations = JSON.parse(cleanContent)
  console.log(`AI returned ${observations.length} observations`)

  return observations
}

export async function POST(request: NextRequest) {
  try {
    console.log('=== Simple API Started ===')

    // Parse form data
    const formData = await request.formData()
    const fdAny = formData as any
    const project = (fdAny.get('project') as string) || ''
    const notes = (fdAny.get('notes') as string) || ''
    const mode = request.headers.get('X-Mode') || 'zip'

    const fileEntries = Array.from(fdAny.getAll('files')).filter((file: any) => {
      return file && file.name && file.size !== undefined && file.stream
    })

    console.log(`Project: ${project}, Notes: ${notes.length} chars, Files: ${fileEntries.length}, Mode: ${mode}`)

    // Validate
    if (!project || !PROJECTS.includes(project as Project)) {
      return new Response('Invalid project', { status: 400 })
    }

    if (!fileEntries || fileEntries.length === 0) {
      return new Response('No files provided', { status: 400 })
    }

    // Step 1: Normalize images
    console.log('Normalizing images...')
    const { images, failed } = await normalizeImages(fileEntries)

    if (images.length === 0) {
      return new Response('No valid images could be processed', { status: 400 })
    }

    console.log(`Normalized ${images.length} images`)

    // Step 2: Simple AI call - no batching, no complex logic
    console.log('Calling AI...')
    const observations = await callSimpleAI(images, project as Project, notes || undefined)

    console.log(`Got ${observations.length} observations from AI`)

    if (mode === 'review') {
      // Return JSON for review
      return new Response(JSON.stringify({
        observations,
        images: images.slice(0, observations.length),
        failed,
        project,
        totalImages: images.length,
        processedImages: observations.length
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    } else {
      // Return ZIP
      console.log('Creating ZIP...')
      const { archive } = createZipStream({
        observations,
        images: images.slice(0, observations.length),
        project: project as Project,
        failed
      })

      const zipBuffer = await streamZipToBuffer(archive)

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
    return new Response(
      JSON.stringify({
        error: 'Processing failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
}
