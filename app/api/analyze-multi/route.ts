import { NextRequest } from 'next/server'
import { CONSTANTS, PROJECTS } from '@/lib/constants/enums'
import type { Project } from '@/lib/constants/enums'
import { normalizeImages } from '@/lib/files/normalize'
import { analyzeImages } from '@/lib/ai/analyze'
import { splitNotesByProject } from '@/lib/utils/projectDetection'
import type { FailedItem } from '@/lib/types'
import { sendProgressUpdate } from '@/lib/progress/manager'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes

export async function POST(request: NextRequest) {
  try {
    console.log('=== Multi-Project Analyze API Request Started ===')
    
    // Parse multipart form data
    const formData = await request.formData()
    console.log('FormData parsed successfully')
    
    // Extract form fields with proper typing
    const fdAny = formData as any
    const notes = (fdAny.get('notes') as string) || null
    const sessionId = (fdAny.get('sessionId') as string) || ''
    const fileEntries = Array.from(fdAny.getAll('files')).filter((file): file is File => file instanceof File)
    
    console.log(`Extracted: notes length=${notes?.length || 0}, files=${fileEntries.length}, sessionId=${sessionId}`)
    
    // Send initial progress update
    if (sessionId) {
      sendProgressUpdate(sessionId, {
        id: sessionId,
        progress: 5,
        label: 'Detecting projects and starting analysis...',
        step: 'starting',
        details: { total: fileEntries.length }
      })
    }
    
    // Split notes by project
    const projectSections = splitNotesByProject(notes || '')
    
    if (projectSections.length === 0) {
      return new Response('No valid projects detected in notes', { status: 400 })
    }
    
    console.log(`Detected ${projectSections.length} projects:`, projectSections.map(s => s.project))
    
    // Validate inputs
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
    
    try {
      console.log(`Processing ${fileEntries.length} files for ${projectSections.length} projects`)
      
      // Step 1: Normalize images (HEIC→JPG, resize, compress) - shared for all projects
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
      
      if (images.length === 0) {
        return new Response('No valid images could be processed', { status: 400 })
      }
      
      console.log(`Normalized ${images.length} images, ${normalizeFailed.length} failed`)
      
      // Step 2: Process each project separately
      const projectResults = []
      const totalFailed = [...normalizeFailed]
      
      for (let i = 0; i < projectSections.length; i++) {
        const { project, notes: projectNotes } = projectSections[i]
        
        console.log(`Processing project ${project} (${i + 1}/${projectSections.length})`)
        
        if (sessionId) {
          const baseProgress = 30 + (i / projectSections.length) * 50 // 30-80% range
          sendProgressUpdate(sessionId, {
            id: sessionId,
            progress: Math.round(baseProgress),
            label: `Analyzing project ${project} (${i + 1} of ${projectSections.length})...`,
            step: 'ai_processing',
            details: { 
              processed: i,
              total: projectSections.length
            }
          })
        }
        
        // Analyze images for this project
        const { observations, failed: aiFailed } = await analyzeImages({
          images,
          project,
          notes: projectNotes,
          sessionId: sessionId || undefined
        })
        
        totalFailed.push(...aiFailed)
        
        if (observations.length > 0) {
          projectResults.push({
            project,
            observations,
            images: images.slice(0, observations.length), // Same images for all projects
            notes: projectNotes,
            processedCount: observations.length
          })
          
          console.log(`Generated ${observations.length} observations for project ${project}`)
        } else {
          console.warn(`No observations generated for project ${project}`)
        }
      }
      
      if (projectResults.length === 0) {
        return new Response('No observations could be generated for any project', { status: 400 })
      }
      
      console.log(`Multi-project analysis complete: ${projectResults.length} projects processed`)
      
      if (sessionId) {
        sendProgressUpdate(sessionId, {
          id: sessionId,
          progress: 100,
          label: `Analysis complete - ${projectResults.length} projects ready for review`,
          step: 'completed',
          details: { 
            processed: projectResults.reduce((sum, r) => sum + r.processedCount, 0),
            total: projectResults.length
          }
        })
      }
      
      // Return multi-project results
      return new Response(JSON.stringify({
        projectResults,
        failed: totalFailed,
        totalImages: images.length,
        projectCount: projectResults.length
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
        error: 'Multi-project analysis failed',
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