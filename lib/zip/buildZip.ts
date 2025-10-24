import archiver from 'archiver'
import type { Observation, ObservationDraft, ProcessedImage, ManifestEntry, FailedItem } from '../types'
import type { Project } from '../constants/enums'
import { buildCSV } from '../csv/buildCsv'
import { deduplicateFilename, generateSimplePhotoSlug, slugFromOriginalName } from '../files/rename'

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

function sanitizeTitleSegment(raw: string | undefined): string {
  if (!raw) return ''
  const cleaned = raw.trim()
  if (!cleaned || cleaned.toUpperCase() === 'N/A') {
    return ''
  }

  const tokens = cleaned
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

  if (tokens.length === 0) {
    return ''
  }

  const formatted = tokens.map(token => {
    if (token.length <= 3 && token === token.toUpperCase()) {
      return token.toUpperCase()
    }
    if (/^[A-Z0-9-]+$/.test(token) && token === token.toUpperCase()) {
      return token
    }
    return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
  })

  return formatted.join('-')
}

function sanitizeSeveritySegment(raw: string | undefined): string {
  if (!raw) return ''
  const withoutParens = raw.replace(/\(.*?\)/g, '').trim()
  return sanitizeTitleSegment(withoutParens)
}

function sanitizeDateSegment(raw: string | undefined, fallbackDate: string): string {
  if (!raw) return fallbackDate
  const match = raw.match(/(\d{4})[-/]?(\d{2})[-/]?(\d{2})/)
  if (!match) return fallbackDate
  const [, year, month, day] = match
  return `${year}${month}${day}`
}

function sanitizeSlugSegment(raw: string | undefined): string {
  if (!raw) return ''
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function buildCategorySegment(observation: Observation | undefined): string {
  if (!observation) return ''
  const categoryType = (observation as ObservationDraft)['Category Type']
  const hra = (observation as ObservationDraft)['High Risk + Significant Exposure']
  const general = observation['General Category']
  const observationCategory = observation['Observation Category']

  if (categoryType === 'HRA + Significant Exposure' && hra) {
    return sanitizeTitleSegment(hra)
  }

  if (general) {
    const formatted = sanitizeTitleSegment(general)
    if (formatted) return formatted
  }

  return sanitizeTitleSegment(observationCategory)
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

  const observationPhotoCounters = new Array(observations.length).fill(0)
  const observationPhotoTotals = observations.map(obs => {
    const draft = obs as ObservationDraft
    return Array.isArray(draft.__photoIndices)
      ? draft.__photoIndices.filter(value => Number.isInteger(value) && value > 0).length
      : 0
  })

  const photoToObservation = new Map<number, number>()
  observations.forEach((obs, obsIndex) => {
    const draft = obs as ObservationDraft
    const indices = Array.isArray(draft.__photoIndices) ? draft.__photoIndices : []
    indices
      .filter(value => Number.isInteger(value) && value > 0)
      .forEach(photoId => {
        if (!photoToObservation.has(photoId)) {
          photoToObservation.set(photoId, obsIndex)
        }
      })
  })

  // Add all photos with descriptive names tied to their observations
  // Format: {Project}-{ObsNo}-{Area}-{Category}-{Severity}-{YYYYMMDD}-{slug}[-N].jpg
  images.forEach((image, imageIndex) => {
    // CRITICAL: Use originalIndex (photoId from Agent 1) to look up the photo name,
    // NOT imageIndex (current position in array after Agent 3B reassignment)!
    const originalPhotoId = image.originalIndex + 1 // originalIndex is 0-based, photoId is 1-based

    let obsIndex = photoToObservation.get(originalPhotoId) ?? -1

    if (obsIndex === -1) {
      obsIndex = observations.findIndex(obs => {
        const draft = obs as ObservationDraft
        return draft.__photoIndices?.includes(originalPhotoId)
      })
      if (obsIndex !== -1) {
        photoToObservation.set(originalPhotoId, obsIndex)
      }
    }

    const relatedObs = obsIndex !== -1 ? observations[obsIndex] : undefined

    if (obsIndex !== -1) {
      observationPhotoCounters[obsIndex] += 1
    }
    const ordinalForObservation = obsIndex !== -1 ? observationPhotoCounters[obsIndex] : 0
    const totalForObservation = obsIndex !== -1 ? observationPhotoTotals[obsIndex] : 0

    const projectSegment = sanitizeProjectSegment(relatedObs?.Project || project)
    const observationNumber = obsIndex !== -1
      ? String(obsIndex + 1).padStart(3, '0')
      : '000'
    const areaSegment = sanitizeTitleSegment(relatedObs?.['Room/Area'])
    const categorySegment = buildCategorySegment(relatedObs)
    const severitySegment = sanitizeSeveritySegment(relatedObs?.['Worst Potential Severity'])
    const dateSegment = sanitizeDateSegment(
      relatedObs?.['Notification Date'],
      datePrefix
    )

    const slugCandidates: string[] = []
    if (photoNames && photoNames[originalPhotoId]) {
      slugCandidates.push(photoNames[originalPhotoId])
    }
    if (relatedObs?.['Observation Description']) {
      slugCandidates.push(generateSimplePhotoSlug(relatedObs['Observation Description']))
    }
    slugCandidates.push(slugFromOriginalName(image.originalName))
    slugCandidates.push(`photo-${String(originalPhotoId).padStart(3, '0')}`)

    const slugSegment = sanitizeSlugSegment(
      slugCandidates.find(candidate => sanitizeSlugSegment(candidate)) || ''
    ) || 'observation'

    const needSuffix =
      obsIndex !== -1
        ? (totalForObservation > 1 || (totalForObservation <= 1 && ordinalForObservation > 1))
        : false
    const suffix = needSuffix ? `-${ordinalForObservation}` : ''

    const parts = [
      projectSegment,
      observationNumber,
      areaSegment,
      categorySegment,
      severitySegment,
      dateSegment,
      slugSegment
    ].filter(Boolean)

    let baseFilename = parts.join('-')
    baseFilename = baseFilename.replace(/-+/g, '-').replace(/^-|-$/g, '')
    baseFilename = limitFilenameLength(baseFilename)

    if (!baseFilename) {
      baseFilename = `${projectSegment}-${observationNumber}-${dateSegment}-photo`
    }

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
