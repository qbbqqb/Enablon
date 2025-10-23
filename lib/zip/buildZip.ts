import archiver from 'archiver'
import type { Observation, ObservationDraft, ProcessedImage, ManifestEntry, FailedItem } from '../types'
import type { Project } from '../constants/enums'
import { buildCSV } from '../csv/buildCsv'
import { deduplicateFilename } from '../files/rename'

export interface ZipContentInput {
  observations: Observation[]
  images: ProcessedImage[]
  project: Project
  failed: FailedItem[]
  photoNames?: Record<number, string> // AI-generated photo names (photoId -> name)
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

  // Track filenames for deduplication
  const usedFilenames = new Set<string>()
  const manifest: ManifestEntry[] = []

  // Get current date for photo naming (YYYYMMDD format)
  const now = new Date()
  const datePrefix = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`

  // Add CSV file
  const csvContent = buildCSV(observations)
  archive.append(Buffer.from(csvContent, 'utf8'), { name: 'observations.csv' })

  // Add all photos with AI-generated descriptive names
  // Format: {YYYYMMDD}-{number}-{ai-generated-name}.jpg
  images.forEach((image, imageIndex) => {
    // CRITICAL: Use originalIndex (photoId from Agent 1) to look up the photo name,
    // NOT imageIndex (current position in array after Agent 3B reassignment)!
    const originalPhotoId = image.originalIndex + 1  // originalIndex is 0-based, photoId is 1-based
    const zipSequenceNumber = imageIndex + 1  // Sequential numbering in ZIP

    let baseFilename: string

    // Prefer AI-generated names, fallback to original filename
    const photoNum = String(zipSequenceNumber).padStart(3, '0')

    if (photoNames && photoNames[originalPhotoId]) {
      // Use AI-generated name based on observation content
      const aiName = photoNames[originalPhotoId]
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
        .replace(/\s+/g, '-') // Spaces to dashes
        .replace(/-+/g, '-') // Collapse multiple dashes
        .replace(/^-|-$/g, '') // Trim dashes
        .substring(0, 80) // Reasonable length limit

      baseFilename = aiName
        ? `${datePrefix}-${photoNum}-${aiName}.jpg`
        : `${datePrefix}-${photoNum}.jpg`
    } else {
      // Simple sequential naming when no AI-generated slug is provided
      baseFilename = `${datePrefix}-${photoNum}.jpg`
    }

    const finalFilename = deduplicateFilename(baseFilename, usedFilenames)

    usedFilenames.add(finalFilename)
    archive.append(image.buffer, { name: `photos/${finalFilename}` })

    // Find which observation this photo belongs to (for manifest)
    // Use originalPhotoId since __photoIndices refers to original photo IDs, not ZIP sequence
    const relatedObs = observations.find(obs => {
      const draft = obs as ObservationDraft
      return draft.__photoIndices?.includes(originalPhotoId)
    })

    manifest.push({
      rowNumber: relatedObs ? observations.indexOf(relatedObs) + 1 : 0,
      originalFilename: image.originalName,
      renamedFilename: finalFilename,
      observationDescription: relatedObs?.['Observation Description'] || 'Orphaned photo - no matching observation'
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
