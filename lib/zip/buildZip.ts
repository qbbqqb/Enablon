import archiver from 'archiver'
import type { Observation, ProcessedImage, ManifestEntry, FailedItem } from '../types'
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
  
  // Add renamed photos - one observation per image (paired by index)
  observations.forEach((obs, index) => {
    const image = images[index]
    if (!image) return

    // Use the project code from the observation itself for multi-project scenarios
    const obsProject = (obs.Project as Project) || project
    const baseFilename = generatePhotoFilename(obsProject, index + 1, obs)
    const finalFilename = deduplicateFilename(baseFilename, usedFilenames)
    usedFilenames.add(finalFilename)

    // Add image to photos/ directory
    archive.append(image.buffer, { name: `photos/${finalFilename}` })

    // Track in manifest
    manifest.push({
      rowNumber: index + 1,
      originalFilename: image.originalName,
      renamedFilename: finalFilename,
      observationDescription: obs['Observation Description']
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
