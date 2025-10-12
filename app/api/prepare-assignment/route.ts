import { NextRequest } from 'next/server'
import { randomUUID } from 'crypto'
import { CONSTANTS, PROJECTS } from '@/lib/constants/enums'
import type { Project } from '@/lib/constants/enums'
import { normalizeImages } from '@/lib/files/normalize'
import { extractObservationShells } from '@/lib/notes/extractShells'
import { orchestratePhotoAssignment } from '@/lib/ai/agents'
import { setSessionData } from '@/lib/session/store'
import type { FailedItem } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes (for AI auto-assignment)

export async function POST(request: NextRequest) {
  try {
    console.log('=== Prepare Assignment API Request Started ===')

    // Parse multipart form data
    const formData = await request.formData()
    console.log('FormData parsed successfully')

    // Extract form fields
    const fdAny = formData as any
    const project = (fdAny.get('project') as string) || ''
    const notes = (fdAny.get('notes') as string) || ''
    const fileEntries = Array.from(fdAny.getAll('files')).filter((file: any) => {
      return file && file.name && file.size !== undefined && file.stream
    })

    console.log(`Extracted: project=${project}, notes length=${notes?.length || 0}, files=${fileEntries.length}`)

    // Validate inputs
    if (!project || !PROJECTS.includes(project as Project)) {
      console.error(`Invalid project: "${project}"`)
      return new Response('Invalid project', { status: 400 })
    }

    if (!notes || !notes.trim()) {
      return new Response('Notes are required for photo assignment mode', { status: 400 })
    }

    if (!fileEntries || fileEntries.length === 0) {
      return new Response('No files provided', { status: 400 })
    }

    if (fileEntries.length > CONSTANTS.MAX_FILES) {
      return new Response(`Too many files. Maximum ${CONSTANTS.MAX_FILES} allowed.`, { status: 400 })
    }

    // Extract observation shells from notes
    const observationShells = extractObservationShells(notes)

    if (observationShells.length === 0) {
      return new Response('No valid numbered notes found. Please use format: "1. Location: Description"', { status: 400 })
    }

    console.log(`Extracted ${observationShells.length} observation shells`)

    const failed: FailedItem[] = []

    // Normalize images (HEIC→JPG, resize, compress)
    console.log('Normalizing images...')
    const { images, failed: normalizeFailed } = await normalizeImages(fileEntries)
    failed.push(...normalizeFailed)

    if (images.length === 0) {
      return new Response('No valid images could be processed', { status: 400 })
    }

    console.log(`Normalized ${images.length} images, ${normalizeFailed.length} failed`)

    // Generate session ID
    const sessionId = randomUUID()

    // Auto-assign photos using Multi-Agent Orchestrator
    console.log('Starting Multi-Agent Orchestrator for photo assignment...')
    const { assignments: autoAssignments, metadata } = await orchestratePhotoAssignment(
      images,
      observationShells
    )
    console.log(`✅ Multi-Agent Orchestrator complete`)
    console.log(`Metadata:`, JSON.stringify(metadata, null, 2))

    // Create photo data for client (with data URLs and tokens)
    const photos = images.map((img, index) => {
      const token = randomUUID()
      const dataUrl = `data:image/jpeg;base64,${img.buffer.toString('base64')}`

      return {
        id: index + 1,
        token,
        originalName: img.originalName,
        url: dataUrl
      }
    })

    // Store in session (using tokens as keys)
    const imagesRecord = images.reduce((acc, img, index) => {
      const token = photos[index].token
      acc[token] = img
      return acc
    }, {} as Record<string, typeof images[0]>)

    const order = photos.map(p => p.token)

    setSessionData(sessionId, {
      projectFallback: project as Project,
      failed,
      images: imagesRecord,
      order,
      observations: [], // Will be populated after enrichment
      observationShells
    })

    console.log(`Session ${sessionId} created with ${images.length} images and ${observationShells.length} observation shells`)

    // Return photo data, observation shells, AND auto-assignments for review
    return new Response(JSON.stringify({
      sessionId,
      photos,
      observationShells,
      autoAssignments, // AI-suggested assignments for review
      failed,
      totalPhotos: images.length,
      totalObservations: observationShells.length
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
        error: 'Preparation failed',
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
