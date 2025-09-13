import { NextRequest } from 'next/server'
import { CONSTANTS, PROJECTS } from '@/lib/constants/enums'
import type { Project } from '@/lib/constants/enums'
import { normalizeImages } from '@/lib/files/normalize'
import { analyzeImages } from '@/lib/ai/analyze'
import { detectAllProjectsFromNotes } from '@/lib/utils/projectDetection'
import type { FailedItem } from '@/lib/types'
import { sendProgressUpdate } from '@/lib/progress/manager'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes

export async function POST(request: NextRequest) {
  try {
    console.log('=== Analyze API Request Started ===')

    // Log request size information
    const contentLength = request.headers.get('content-length')
    if (contentLength) {
      const sizeMB = parseInt(contentLength) / (1024 * 1024)
      console.log(`Request Content-Length: ${sizeMB.toFixed(2)}MB`)

      if (sizeMB > 4.5) {
        console.error(`⚠️ Request size ${sizeMB.toFixed(2)}MB exceeds platform limit of 4.5MB`)
        return new Response('Request too large', { status: 413 })
      }
    }

    // Parse multipart form data
    const formData = await request.formData()
    console.log('FormData parsed successfully')
    
    // Extract form fields with proper typing
    const fdAny = formData as any
    const project = (fdAny.get('project') as string) || ''
    const notes = (fdAny.get('notes') as string) || null
    const sessionId = (fdAny.get('sessionId') as string) || ''
    const batchIndex = parseInt((fdAny.get('batchIndex') as string) || '0')
    const totalBatches = parseInt((fdAny.get('totalBatches') as string) || '1')
    const fileEntries = Array.from(fdAny.getAll('files')).filter((file: any) => {
      // In Node.js, FormData files are different from browser File objects
      return file && file.name && file.size !== undefined && file.stream
    })

    console.log(`Extracted: project=${project}, notes length=${notes?.length || 0}, files=${fileEntries.length}, sessionId=${sessionId}, batch=${batchIndex + 1}/${totalBatches}`)
    
    // Send initial progress update
    if (sessionId) {
      const batchLabel = totalBatches > 1
        ? `Processing batch ${batchIndex + 1} of ${totalBatches}...`
        : 'Starting analysis...'

      sendProgressUpdate(sessionId, {
        id: sessionId,
        progress: 5,
        label: batchLabel,
        step: 'starting',
        details: {
          total: fileEntries.length,
          batchIndex: batchIndex + 1,
          totalBatches: totalBatches
        }
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
    const totalSize: number = fileEntries.reduce((sum: number, file: any) => sum + (file.size || 0), 0)
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
      
      // Detect all projects from notes for multi-project analysis
      const allDetectedProjects = notes ? detectAllProjectsFromNotes(notes) : []
      console.log(`Detected ${allDetectedProjects.length} projects in notes:`, allDetectedProjects)
      
      if (sessionId) {
        const batchPrefix = totalBatches > 1 ? `Batch ${batchIndex + 1}/${totalBatches}: ` : ''
        const aiLabel = `${batchPrefix}Images processed. Starting ${allDetectedProjects.length > 1 ? 'multi-project ' : ''}analysis...`

        sendProgressUpdate(sessionId, {
          id: sessionId,
          progress: 35,
          label: aiLabel,
          step: 'ai_starting',
          details: {
            processed: images.length,
            total: fileEntries.length,
            batchIndex: batchIndex + 1,
            totalBatches: totalBatches
          }
        })
      }
      
      // Step 2: AI analysis in micro-batches  
      console.log('Step 2: Analyzing with AI...')
      const { observations, failed: aiFailed } = await analyzeImages({
        images,
        project: project as Project,
        notes: notes || undefined,
        sessionId: sessionId || undefined,
        allProjects: allDetectedProjects.length > 1 ? allDetectedProjects : undefined
      })
      failed.push(...aiFailed)
      
      if (observations.length === 0) {
        return new Response('No observations could be generated', { status: 400 })
      }
      
      console.log(`Generated ${observations.length} observations, ${aiFailed.length} failed`)
      
      if (sessionId) {
        const finalLabel = totalBatches > 1
          ? `Batch ${batchIndex + 1}/${totalBatches} complete - ${observations.length} observations generated`
          : 'Analysis complete - ready for review'

        sendProgressUpdate(sessionId, {
          id: sessionId,
          progress: 100,
          label: finalLabel,
          step: 'completed',
          details: {
            processed: observations.length,
            total: images.length,
            batchIndex: batchIndex + 1,
            totalBatches: totalBatches
          }
        })
      }
      
      // Return observations and images for review (not ZIP file)
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
          'Content-Type': 'application/json',
        }
      })
      
    } catch (processingError) {
      console.error('Processing error:', processingError)
      throw processingError
    }
    
  } catch (error) {
    console.error('API Error:', error)
    
    return new Response(
      JSON.stringify({
        error: 'Analysis failed',
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