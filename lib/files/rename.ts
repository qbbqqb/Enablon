import type { Observation } from '../types'
import type { Project } from '../constants/enums'

export function generatePhotoFilename(
  project: Project,
  obsNo: number,
  observation: Observation,
  photoIndex: number = 1
): string {
  // Zero-padded observation number
  const obsNoStr = obsNo.toString().padStart(3, '0')

  // Area code (max 10 chars for readability)
  const area = sanitizeForFilename(observation['Room/Area']).substring(0, 10)

  // More descriptive category with severity
  const categoryType = observation['Category Type'] === 'HRA + Significant Exposure' ? 'HRA' : 'GEN'
  const specificCategory = observation['Category Type'] === 'HRA + Significant Exposure'
    ? sanitizeForFilename(observation['High Risk + Significant Exposure']).substring(0, 12)
    : sanitizeForFilename(observation['General Category']).substring(0, 12)

  // Severity level (abbreviated)
  const severity = getSeverityCode(observation['Worst Potential Severity'])

  // Observation category (New/Near Miss/Positive)
  const obsCategory = getObsCategoryCode(observation['Observation Category'])

  // Short description from the observation
  const description = generateShortSlug(observation['Observation Description'], 30)

  // Date (YYYYMMDD)
  const dateParts = observation['Notification Date'].split('/')
  const dateStr = `${dateParts[2]}${dateParts[1]}${dateParts[0]}` // DD/MM/YYYY -> YYYYMMDD

  // Photo number for multiple photos per observation
  const photoNum = photoIndex > 1 ? `-${photoIndex}` : ''

  return `${project}-${obsNoStr}-${area}-${categoryType}-${specificCategory}-${severity}-${obsCategory}-${description}-${dateStr}${photoNum}.jpg`
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