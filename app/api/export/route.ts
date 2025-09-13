import { NextRequest } from 'next/server'
import { PROJECTS } from '@/lib/constants/enums'
import type { Project, Observation } from '@/lib/constants/enums'
import { createZipStream, streamZipToBuffer } from '@/lib/zip/buildZip'
import type { FailedItem } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 60 // 1 minute for export

export async function POST(request: NextRequest) {
  try {
    console.log('=== Export API Request Started ===')
    
    // Parse JSON body (reviewed observations and images)
    const body = await request.json()
    const { observations, project, failed = [], images = [] } = body
    
    console.log(`Export request: project=${project}, observations=${observations?.length || 0}`)
    
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
      ? (observations[0]?.Project as Project) || 'GVX04'
      : (project as Project)
    
    // Reconstruct Buffer objects from JSON-serialized data
    const processedImages = images.map((img: any, index: number) => {
      const reconstructedBuffer = img.buffer?.type === 'Buffer' ? Buffer.from(img.buffer.data) : img.buffer
      console.log(`Image ${index + 1}: buffer type=${typeof reconstructedBuffer}, isBuffer=${Buffer.isBuffer(reconstructedBuffer)}, size=${reconstructedBuffer?.length || 0}`)
      return {
        ...img,
        buffer: reconstructedBuffer
      }
    })
    
    // Create ZIP with reviewed observations and images
    const { archive } = createZipStream({
      observations: observations as Observation[],
      images: processedImages, // Include reconstructed images
      project: projectForZip,
      failed: failed as FailedItem[]
    })
    
    // Convert archive to buffer
    const zipBuffer = await streamZipToBuffer(archive)
    
    console.log(`ZIP created: ${zipBuffer.length} bytes`)
    
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