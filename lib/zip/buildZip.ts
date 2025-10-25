import archiver from 'archiver'
import type { Observation, ObservationDraft, ProcessedImage, ManifestEntry, FailedItem } from '../types'
import type { Project } from '../constants/enums'
import { buildCSV } from '../csv/buildCsv'
import { generateSimpleSequentialName } from '../files/rename'

export interface ZipContentInput {
  observations: Observation[]
  images: ProcessedImage[]
  project: Project
  failed: FailedItem[]
  photoNames?: Record<number, string> // AI-generated photo names (NOT USED with simple naming)
}

export function createZipStream(input: ZipContentInput): {
  archive: archiver.Archiver
  manifest: ManifestEntry[]
} {
  const { observations, images, project, failed, photoNames } = input

  // Create archiver instance
  const archive = archiver('zip', {
    zlib: { level: 9 } // Maximum compression
  })

  // Track filenames and manifest
  const usedFilenames = new Set<string>()
  const manifest: ManifestEntry[] = []

  // Get current date/time for photo naming
  const now = new Date()

  // Add CSV file
  const csvContent = buildCSV(observations)
  archive.append(Buffer.from(csvContent, 'utf8'), { name: 'observations.csv' })

  // Add all photos with simple sequential naming
  // Format: YYYYMMDD-HHMM-###.jpg (e.g., 20251024-1430-001.jpg)
  images.forEach((image, imageIndex) => {
    // Simple sequential naming: 001, 002, 003...
    const photoNumber = imageIndex + 1  // 1-based index
    const finalName = generateSimpleSequentialName(now, photoNumber)
    
    usedFilenames.add(finalName)
    archive.append(image.buffer, { name: `photos/${finalName}` })

    // Manifest: Track original → renamed mapping
    manifest.push({
      rowNumber: 0,  // Photos not tied to specific observation rows
      originalFilename: image.originalName,
      renamedFilename: finalName,
      observationDescription: 'Photo included in batch upload'
    })
  })
  
  // Add manifest.json
  archive.append(
    Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
    { name: 'manifest.json' }
  )
  
  // Add FAILED.json if there are any failures
  if (failed.length > 0) {
    archive.append(
      Buffer.from(JSON.stringify(failed, null, 2), 'utf8'),
      { name: 'FAILED.json' }
    )
  }
  
  return { archive, manifest }
}

export async function streamZipToBuffer(archive: archiver.Archiver): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    
    archive.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    
    archive.on('end', () => {
      resolve(Buffer.concat(chunks))
    })
    
    archive.on('error', (err) => {
      reject(err)
    })
    
    // Finalize the archive (this triggers the streaming)
    archive.finalize()
  })
}
