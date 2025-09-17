import type { Observation } from '../types'
import type { Project } from '../constants/enums'

export function generatePhotoFilename(
  project: Project,
  obsNo: number,
  observation: Observation,
  photoIndex: number = 1
): string {
  // Zero-padded observation number for CSV cross-reference
  const obsNoStr = obsNo.toString().padStart(3, '0')

  // Short description from the observation (key safety issue)
  const description = generateShortSlug(observation['Observation Description'], 25)

  // Date (YYYYMMDD)
  const dateParts = observation['Notification Date'].split('/')
  const dateStr = `${dateParts[2]}${dateParts[1]}${dateParts[0]}` // DD/MM/YYYY -> YYYYMMDD

  // Photo number for multiple photos per observation
  const photoNum = photoIndex > 1 ? `-${photoIndex}` : ''

  // Format: PROJECT-OBSNO-DESCRIPTION-DATE
  return `${project}-${obsNoStr}-${description}-${dateStr}${photoNum}.jpg`
}

function getSeverityCode(severity: string): string {
  switch (severity) {
    case 'Major (1 Day)': return 'MAJOR'
    case 'Potentially Serious/Serious (Immediate)': return 'SERIOUS'
    case 'Positive Observation': return 'POSITIVE'
    case 'Minor (7 Days)': return 'MINOR'
    default: return 'UNK'
  }
}

function getObsCategoryCode(category: string): string {
  switch (category) {
    case 'New At Risk Observation': return 'ATRISK'
    case 'New Near Miss': return 'NEARMISS'
    case 'New Positive Observation': return 'POSITIVE'
    default: return 'UNK'
  }
}

function sanitizeForFilename(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9\s-]/g, '') // Remove special characters except spaces and hyphens
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
}

function generateShortSlug(description: string, maxLength: number = 40): string {
  // Extract meaningful words (3-8 characters typically)
  const words = description
    .toLowerCase()
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length >= 3 && word.length <= 12)
    .slice(0, 4) // Take first 4 meaningful words
  
  let slug = words.join('-')
  
  // Ensure it doesn't exceed maxLength
  if (slug.length > maxLength) {
    slug = slug.substring(0, maxLength).replace(/-[^-]*$/, '') // Cut at word boundary
  }
  
  return slug || 'observation'
}

export function deduplicateFilename(filename: string, existingFilenames: Set<string>): string {
  if (!existingFilenames.has(filename)) {
    return filename
  }
  
  const parts = filename.split('.')
  const extension = parts.pop()
  const baseName = parts.join('.')
  
  let counter = 2
  let newFilename = `${baseName}-${counter}.${extension}`
  
  while (existingFilenames.has(newFilename)) {
    counter++
    newFilename = `${baseName}-${counter}.${extension}`
  }
  
  return newFilename
}

// Create a short, safe slug from an original photo filename
export function slugFromOriginalName(name: string, maxLength: number = 24): string {
  const base = name.replace(/\.[^.]+$/, '') // drop extension
  let slug = base
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
  if (slug.length > maxLength) {
    slug = slug.substring(0, maxLength).replace(/-[^-]*$/, '')
  }
  return slug || 'img'
}
