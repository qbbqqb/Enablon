import { NextRequest } from 'next/server'
import { PROJECTS } from '@/lib/constants/enums'
import type { Project } from '@/lib/constants/enums'
import type { Observation, ObservationDraft, ProcessedImage } from '@/lib/types'
import { createZipStream, streamZipToBuffer } from '@/lib/zip/buildZip'
import type { FailedItem } from '@/lib/types'
import { getSessionData, clearSessionData } from '@/lib/session/store'

export const runtime = 'nodejs'
export const maxDuration = 60 // 1 minute for export

export async function POST(request: NextRequest) {
  try {
    console.log('=== Export API Request Started ===')
    
    // Parse JSON body (reviewed observations and images)
    const body = await request.json()
    const { observations, project, sessionId } = body as {
      observations: ObservationDraft[]
      project: string
      sessionId?: string
    }
    
    console.log(`Export request: project=${project}, observations=${observations?.length || 0}, session=${sessionId || 'none'}`)

    if (!sessionId || typeof sessionId !== 'string') {
      return new Response('Missing sessionId', { status: 400 })
    }

    const sessionData = getSessionData(sessionId)
    if (!sessionData) {
      return new Response('Session data expired or missing. Please rerun the analysis.', { status: 410 })
    }
    
    // Validate inputs - allow "mixed" for multi-project exports
    if (!project || (!PROJECTS.includes(project as Project) && project !== 'mixed')) {
      return new Response('Invalid project', { status: 400 })
    }
    
    if (!observations || !Array.isArray(observations) || observations.length === 0) {
      return new Response('No observations provided', { status: 400 })
    }
    
    // Validate observation structure
    for (let i = 0; i < observations.length; i++) {
      const obs = observations[i]
      if (!obs.Project || !obs['Observation Description']) {
        return new Response(`Invalid observation at index ${i}: missing required fields`, { status: 400 })
      }
    }
    
    console.log('Creating ZIP with reviewed observations and images...')
    
    // For multi-project, use the first project from observations for ZIP structure
    // The actual project codes will be used per observation in the CSV and filename generation
    const projectForZip = project === 'mixed' 
      ? ((observations?.[0]?.Project as Project) || sessionData.project)
      : (project as Project)
    
    const imagesByToken = sessionData.images
    const orderedTokens = sessionData.order.filter(token => imagesByToken[token])
    const usedFallback = new Set<string>()

    const sanitizedObservations: Observation[] = []
    const exportImageGroups: ProcessedImage[][] = []

    for (const draft of observations as ObservationDraft[]) {
      const { __photoToken, __photoTokens, ...rest } = draft
      const tokens = Array.isArray(__photoTokens) && __photoTokens.length > 0
        ? __photoTokens
        : typeof __photoToken === 'string' && __photoToken
          ? [__photoToken]
          : []

      const imagesForObservation: ProcessedImage[] = []

      tokens.forEach(token => {
        const image = imagesByToken[token]
        if (image) {
          imagesForObservation.push(image)
        }
      })

      if (imagesForObservation.length === 0) {
        const fallbackToken = orderedTokens.find(t => !usedFallback.has(t))
        if (fallbackToken) {
          const image = imagesByToken[fallbackToken]
          if (image) {
            imagesForObservation.push(image)
            usedFallback.add(fallbackToken)
          }
        }
      }

      if (imagesForObservation.length === 0 && orderedTokens.length > 0) {
        const image = imagesByToken[orderedTokens[0]]
        if (image) {
          imagesForObservation.push(image)
        }
      }

      sanitizedObservations.push(rest as Observation)
      exportImageGroups.push(imagesForObservation)
    }

    if (exportImageGroups.every(group => group.length === 0)) {
      return new Response('No processed images available for export. Please rerun the analysis.', { status: 410 })
    }

    // Create ZIP with reviewed observations and images
    const { archive } = createZipStream({
      observations: sanitizedObservations,
      images: exportImageGroups,
      project: projectForZip,
      failed: sessionData.failed as FailedItem[]
    })
    
    // Convert archive to buffer
    const zipBuffer = await streamZipToBuffer(archive)

    console.log(`ZIP created: ${zipBuffer.length} bytes`)

    clearSessionData(sessionId)
    
    // Return ZIP file
    return new Response(zipBuffer as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="enablon-observations-${project.toLowerCase()}-reviewed-${new Date().toISOString().split('T')[0]}.zip"`,
        'Content-Length': zipBuffer.length.toString()
      }
    })
    
  } catch (error) {
    console.error('Export API Error:', error)
    
    return new Response(
      JSON.stringify({
        error: 'Export failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
}
