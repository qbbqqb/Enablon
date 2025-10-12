import { NextRequest } from 'next/server'
import type { Project } from '@/lib/constants/enums'
import { getSessionData, setSessionData } from '@/lib/session/store'
import { enrichObservation } from '@/lib/ai/enrich'
import type { Observation, FailedItem, ProcessedImage } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes

interface EnrichRequest {
  sessionId: string
  assignments: Record<number, number[]> // obsId -> photoId[]
}

export async function POST(request: NextRequest) {
  try {
    console.log('=== Enrich API Request Started ===')

    const body: EnrichRequest = await request.json()
    const { sessionId, assignments } = body

    console.log(`SessionId: ${sessionId}`)
    console.log(`Assignments:`, assignments)

    // Retrieve session data
    const sessionData = getSessionData(sessionId)

    if (!sessionData) {
      console.error(`❌ Session not found: ${sessionId}`)
      console.error(`Session may have expired (15min TTL) or was never created`)
      return new Response(JSON.stringify({
        error: 'Session not found or expired',
        message: 'Your session may have expired. Please start the photo assignment process again.',
        sessionId
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    console.log(`✅ Session found: ${sessionId}`)

    const { images, observationShells, projectFallback, order } = sessionData

    if (!observationShells || observationShells.length === 0) {
      return new Response('No observation shells found in session', { status: 400 })
    }

    console.log(`Found ${observationShells.length} observation shells in session`)
    console.log(`Found ${Object.keys(images).length} images in session`)

    // Create mapping from photo ID to token (based on order array)
    const photoIdToToken: Record<number, string> = {}
    order.forEach((token, index) => {
      photoIdToToken[index + 1] = token // IDs are 1-based
    })

    // Enrich each observation with its assigned photos
    const observations: Observation[] = []
    const failed: FailedItem[] = sessionData.failed || []

    for (const shell of observationShells) {
      const assignedPhotoIds = assignments[shell.id] || []

      if (assignedPhotoIds.length === 0) {
        console.warn(`No photos assigned to observation #${shell.id}, skipping enrichment`)
        failed.push({
          originalFilename: `observation_${shell.id}`,
          reason: 'No photos assigned',
          step: 'photo_assignment'
        })
        continue
      }

      // Get ProcessedImage objects for assigned photos
      const assignedPhotos: ProcessedImage[] = []
      for (const photoId of assignedPhotoIds) {
        const token = photoIdToToken[photoId]
        if (token && images[token]) {
          assignedPhotos.push(images[token])
        } else {
          console.warn(`Photo ID ${photoId} not found in session for observation #${shell.id}`)
        }
      }

      if (assignedPhotos.length === 0) {
        console.warn(`Could not find any valid photos for observation #${shell.id}`)
        failed.push({
          originalFilename: `observation_${shell.id}`,
          reason: 'Assigned photos not found in session',
          step: 'photo_retrieval'
        })
        continue
      }

      console.log(`Enriching observation #${shell.id} with ${assignedPhotos.length} photo(s)`)

      // Call AI to enrich this observation
      const { observation, failed: enrichFailed } = await enrichObservation({
        noteText: shell.fullNote,
        photos: assignedPhotos,
        project: projectFallback,
        observationNumber: shell.id
      })

      if (observation) {
        observations.push(observation)
      } else if (enrichFailed) {
        failed.push(enrichFailed)
      }
    }

    console.log(`Successfully enriched ${observations.length} observations`)
    console.log(`Failed: ${failed.length}`)

    // Update session with enriched observations
    setSessionData(sessionId, {
      ...sessionData,
      observations
    })

    // Return enriched observations
    return new Response(JSON.stringify({
      observations,
      failed,
      totalObservations: observations.length,
      totalFailed: failed.length
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      }
    })

  } catch (error) {
    console.error('API Error:', error)

    return new Response(
      JSON.stringify({
        error: 'Enrichment failed',
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
