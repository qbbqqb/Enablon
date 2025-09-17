import { NextRequest } from 'next/server'
import { CONSTANTS, PROJECTS } from '@/lib/constants/enums'
import type { Project } from '@/lib/constants/enums'
import { normalizeImages } from '@/lib/files/normalize'
import { analyzeImages } from '@/lib/ai/analyze'
import { createZipStream, streamZipToBuffer } from '@/lib/zip/buildZip'
import type { FailedItem } from '@/lib/types'
import { sendProgressUpdate } from '@/lib/progress/manager'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes

export async function POST(request: NextRequest) {
  try {
    console.log('=== API Request Started ===')

    // Check if this is review mode (returns JSON) or generate mode (returns ZIP)
    const reviewMode = request.headers.get('X-Mode') === 'review'
    console.log(`Mode: ${reviewMode ? 'review' : 'generate'}`)
    
    // Parse multipart form data
    const formData = await request.formData()
    console.log('FormData parsed successfully')
    
    // Extract form fields with proper typing - cast formData to any to handle typing issues
    const fdAny = formData as any
    const project = (fdAny.get('project') as string) || ''
    const notes = (fdAny.get('notes') as string) || null
    const sessionId = (fdAny.get('sessionId') as string) || ''
    const fileEntries = Array.from(fdAny.getAll('files')).filter((file): file is File => file instanceof File)
    
    console.log(`Extracted: project=${project}, notes length=${notes?.length || 0}, files=${fileEntries.length}, sessionId=${sessionId}`)
    
    // Send initial progress update
    if (sessionId) {
      sendProgressUpdate(sessionId, {
        id: sessionId,
        progress: 5,
        label: 'Starting processing...',
        step: 'starting',
        details: { total: fileEntries.length }
      })
    }
    
    // Validate inputs
    if (!project || !PROJECTS.includes(project as Project)) {
      console.error(`Invalid project: "${project}", valid projects:`, PROJECTS)
      return new Response('Invalid project', { status: 400 })
    }
    
    if (!fileEntries || fileEntries.length === 0) {
      return new Response('No files provided', { status: 400 })
    }
    
    if (fileEntries.length > CONSTANTS.MAX_FILES) {
      return new Response(`Too many files. Maximum ${CONSTANTS.MAX_FILES} allowed.`, { status: 400 })
    }
    
    // Validate total size
    const totalSize = fileEntries.reduce((sum, file) => sum + file.size, 0)
    if (totalSize > CONSTANTS.MAX_UPLOAD_SIZE) {
      return new Response(`Total upload too large. Maximum ${CONSTANTS.MAX_UPLOAD_SIZE / 1024 / 1024}MB allowed.`, { status: 400 })
    }
    
    const failed: FailedItem[] = []
    
    try {
      console.log(`Processing ${fileEntries.length} files for project ${project}`)
      
      // Step 1: Normalize images (HEIC→JPG, resize, compress)
      console.log('Step 1: Normalizing images...')
      if (sessionId) {
        sendProgressUpdate(sessionId, {
          id: sessionId,
          progress: 15,
          label: 'Processing images (converting, resizing)...',
          step: 'normalizing',
          details: { total: fileEntries.length }
        })
      }
      
      const { images, failed: normalizeFailed } = await normalizeImages(fileEntries)
      failed.push(...normalizeFailed)
      
      if (images.length === 0) {
        return new Response('No valid images could be processed', { status: 400 })
      }
      
      console.log(`Normalized ${images.length} images, ${normalizeFailed.length} failed`)
      
      if (sessionId) {
        sendProgressUpdate(sessionId, {
          id: sessionId,
          progress: 35,
          label: 'Images processed. Starting AI analysis...',
          step: 'ai_starting',
          details: { processed: images.length, total: fileEntries.length }
        })
      }
      
      // Step 2: AI analysis in micro-batches  
      console.log('Step 2: Analyzing with AI...')
      const { observations, failed: aiFailed } = await analyzeImages({
        images,
        project: project as Project,
        notes: notes || undefined,
        sessionId: sessionId || undefined
      })
      failed.push(...aiFailed)
      
      if (observations.length === 0) {
        return new Response('No observations could be generated', { status: 400 })
      }
      
      console.log(`Generated ${observations.length} observations, ${aiFailed.length} failed`)

      if (reviewMode) {
        // Review mode: return JSON for client-side review
        if (sessionId) {
          sendProgressUpdate(sessionId, {
            id: sessionId,
            progress: 100,
            label: 'Analysis complete - ready for review',
            step: 'completed',
            details: { processed: observations.length, total: images.length }
          })
        }

        return new Response(JSON.stringify({
          observations,
          images: images.slice(0, observations.length), // Only include successfully analyzed images
          failed,
          project,
          totalImages: images.length,
          processedImages: observations.length
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        })
      } else {
        // Generate mode: create and return ZIP file
        if (sessionId) {
          sendProgressUpdate(sessionId, {
            id: sessionId,
            progress: 85,
            label: 'AI analysis complete. Creating ZIP file...',
            step: 'zip_creation',
            details: { processed: observations.length, total: images.length }
          })
        }

        // Step 3: Create ZIP with CSV, photos, manifest, and failed items
        console.log('Step 3: Building ZIP...')
        const { archive, manifest } = createZipStream({
          observations,
          images: images.slice(0, observations.length), // Only include successfully analyzed images
          project: project as Project,
          failed
        })

        // Convert archive to buffer
        const zipBuffer = await streamZipToBuffer(archive)

        console.log(`ZIP created: ${zipBuffer.length} bytes, ${manifest.length} files mapped`)

        // Return ZIP file - cast buffer for compatibility
        return new Response(zipBuffer as BodyInit, {
          status: 200,
          headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="enablon-observations-${project.toLowerCase()}-${new Date().toISOString().split('T')[0]}.zip"`,
            'Content-Length': zipBuffer.length.toString()
          }
        })
      }
      
    } catch (processingError) {
      console.error('Processing error:', processingError)
      
      // If we have some partial results, still try to return something
      if (failed.length > 0) {
        const errorZip = createZipStream({
          observations: [],
          images: [],
          project: project as Project,
          failed
        })
        
        const errorBuffer = await streamZipToBuffer(errorZip.archive)
        
        return new Response(errorBuffer as BodyInit, {
          status: 206, // Partial Content
          headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="enablon-observations-${project.toLowerCase()}-partial-${new Date().toISOString().split('T')[0]}.zip"`,
            'Content-Length': errorBuffer.length.toString()
          }
        })
      }
      
      throw processingError
    }
    
  } catch (error) {
    console.error('API Error:', error)
    
    return new Response(
      JSON.stringify({
        error: 'Processing failed',
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