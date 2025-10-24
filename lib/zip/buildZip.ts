import archiver from 'archiver'
import type { Observation, ObservationDraft, ProcessedImage, ManifestEntry, FailedItem } from '../types'
import type { Project } from '../constants/enums'
import { buildCSV } from '../csv/buildCsv'
import { deduplicateFilename, buildObservationPhotoSlug } from '../files/rename'

export interface ZipContentInput {
  observations: Observation[]
  images: ProcessedImage[]
  project: Project
  failed: FailedItem[]
  photoNames?: Record<number, string> // AI-generated photo names (photoId -> name)
}

const MAX_FILENAME_LENGTH = 160

function sanitizeProjectSegment(project: string | undefined): string {
  if (!project) return 'PROJECT'
  return project
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    || 'PROJECT'
}

function sanitizeDateSegment(raw: string | undefined, fallbackDate: string): string {
  if (!raw) return fallbackDate
  const match = raw.match(/(\d{4})[-/]?(\d{2})[-/]?(\d{2})/)
  if (!match) return fallbackDate
  const [, year, month, day] = match
  return `${year}${month}${day}`
}

function limitFilenameLength(name: string): string {
  if (name.length <= MAX_FILENAME_LENGTH) {
    return name
  }
  return name.slice(0, MAX_FILENAME_LENGTH).replace(/-+$/, '')
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

  const photoToObservation = new Map<number, { obsIndex: number; position: number; total: number }>()
  observations.forEach((obs, obsIndex) => {
    const draft = obs as ObservationDraft
    const indices = Array.isArray(draft.__photoIndices) ? draft.__photoIndices : []
    indices
      .filter(value => Number.isInteger(value) && value > 0)
      .forEach((photoId, position, validArray) => {
        if (photoToObservation.has(photoId)) {
          return
        }
        photoToObservation.set(photoId, {
          obsIndex,
          position,
          total: validArray.length
        })
      })
  })

  // Add all photos with descriptive names tied to their observations
  // Format: {PROJECT}-OBS{###}-{YYYYMMDD}-{slug}[-N].jpg
  images.forEach((image, imageIndex) => {
    // CRITICAL: Use originalIndex (photoId from Agent 1) to look up the photo name,
    // NOT imageIndex (current position in array after Agent 3B reassignment)!
    const originalPhotoId = image.originalIndex + 1 // originalIndex is 0-based, photoId is 1-based

    const obsInfo = photoToObservation.get(originalPhotoId)
    const obsIndex = obsInfo?.obsIndex ?? -1
    const relatedObs = obsIndex !== -1 ? observations[obsIndex] : undefined

    const projectSegment = sanitizeProjectSegment(relatedObs?.Project || project)
    const observationNumber = obsIndex !== -1
      ? `OBS${String(obsIndex + 1).padStart(3, '0')}`
      : 'OBS000'
    const dateSegment = sanitizeDateSegment(
      relatedObs?.['Notification Date'],
      datePrefix
    )

    const slugSegment = buildObservationPhotoSlug({
      aiName: photoNames?.[originalPhotoId],
      description: relatedObs?.['Observation Description'],
      originalName: image.originalName
    })

    const suffix = obsInfo && obsInfo.total > 1
      ? `-${obsInfo.position + 1}`
      : ''

    const baseFilename = limitFilenameLength(
      [projectSegment, observationNumber, dateSegment, slugSegment]
        .filter(Boolean)
        .join('-') || `${projectSegment}-${observationNumber}-${dateSegment}-photo`
    )

    const finalName = `${baseFilename}${suffix}.jpg`
    const dedupedName = deduplicateFilename(finalName, usedFilenames)

    usedFilenames.add(dedupedName)
    archive.append(image.buffer, { name: `photos/${dedupedName}` })

    manifest.push({
      rowNumber: obsIndex !== -1 ? obsIndex + 1 : 0,
      originalFilename: image.originalName,
      renamedFilename: dedupedName,
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
