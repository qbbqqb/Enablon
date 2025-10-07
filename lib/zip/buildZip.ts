import archiver from 'archiver'
import type { Observation, ObservationDraft, ProcessedImage, ManifestEntry, FailedItem } from '../types'
import type { Project } from '../constants/enums'
import { buildCSV } from '../csv/buildCsv'
import { generatePhotoFilename, deduplicateFilename } from '../files/rename'

export interface ZipContentInput {
  observations: Observation[]
  images: ProcessedImage[]
  project: Project
  failed: FailedItem[]
}

export function createZipStream(input: ZipContentInput): {
  archive: archiver.Archiver
  manifest: ManifestEntry[]
} {
  const { observations, images, project, failed } = input
  
  // Create archiver instance
  const archive = archiver('zip', {
    zlib: { level: 9 } // Maximum compression
  })
  
  // Track filenames for deduplication
  const usedFilenames = new Set<string>()
  const manifest: ManifestEntry[] = []
  
  // Add CSV file
  const csvContent = buildCSV(observations)
  archive.append(Buffer.from(csvContent, 'utf8'), { name: 'observations.csv' })
  
  // Add all photos with their original names
  // Photos serve as visual context for the observations
  images.forEach((image, imageIndex) => {
    // Use original filename or fallback to numbered format
    const originalBase = image.originalName.replace(/\.[^.]+$/, '')
    const extension = image.originalName.match(/\.[^.]+$/)?.[0] || '.jpg'

    // Clean the filename
    const cleanBase = originalBase
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 50)
      || `photo-${String(imageIndex + 1).padStart(3, '0')}`

    const baseFilename = `${project}-${cleanBase}${extension}`
    const finalFilename = deduplicateFilename(baseFilename, usedFilenames)
    usedFilenames.add(finalFilename)

    archive.append(image.buffer, { name: `photos/${finalFilename}` })

    // Find which observation(s) reference this photo (1-based index)
    const photoNumber = imageIndex + 1
    const relatedObs = observations.find(obs => {
      const draft = obs as ObservationDraft
      return draft.__photoIndices?.includes(photoNumber)
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
