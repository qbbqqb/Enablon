import type { Observation } from '../types'
import type { Project } from '../constants/enums'

export function generatePhotoFilename(
  project: Project,
  obsNo: number,
  observation: Observation,
  photoIndex: number = 1
): string {
  const locationSegment = pickKeywordSegment(observation['Room/Area'], 'Site')

  const issueSource =
    observation['High Risk + Significant Exposure'] ||
    observation['General Category'] ||
    observation['Observation Category'] ||
    observation['Observation Description']

  const issueSegment = pickKeywordSegment(issueSource, 'Issue')

  // Date (YYYYMMDD)
  const dateParts = observation['Notification Date'].split('/')
  const dateStr = `${dateParts[2]}${dateParts[1]}${dateParts[0]}` // DD/MM/YYYY -> YYYYMMDD

  // Photo number for multiple photos per observation
  const photoNum = photoIndex > 1 ? `-${photoIndex}` : ''

  // Format: PROJECT-LOCATION-ISSUE-YYYYMMDD
  return `${project}-${locationSegment}-${issueSegment}-${dateStr}${photoNum}.jpg`
}

const STOP_WORDS = new Set([
  'new',
  'observation',
  'atrisk',
  'at',
  'risk',
  'issue',
  'general',
  'category',
  'positive',
  'other'
])

function pickKeywordSegment(source: string | undefined, fallback: string): string {
  const tokens = (source?.match(/[A-Za-z0-9]+/g) ?? []).map(token => token.trim()).filter(Boolean)
  if (tokens.length === 0) {
    return fallback
  }

  const preferred =
    tokens.find(token => {
      const normalized = token.toLowerCase()
      return !STOP_WORDS.has(normalized) && normalized.length > 2
    }) || tokens.find(token => token.length > 0)

  if (!preferred) {
    return fallback
  }

  return truncateSegment(formatSegment(preferred)) || fallback
}

function formatSegment(raw: string): string {
  if (!raw) return ''
  if (raw.length <= 4 && raw === raw.toUpperCase()) {
    return raw.toUpperCase()
  }
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()
}

function truncateSegment(segment: string, maxLength = 18): string {
  if (segment.length <= maxLength) {
    return segment
  }
  return segment.slice(0, maxLength)
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
export function slugFromOriginalName(name: string, maxLength: number = 40): string {
  const base = name.replace(/\.[^.]+$/, '') // drop extension

  // Special handling for common WhatsApp naming pattern
  // e.g., "WhatsApp Image 2025-09-16 at 18.10.59 (13).jpeg"
  const wa = /whatsapp\s*image\s*(\d{4})-(\d{2})-(\d{2}).*?(\d{2})\.(\d{2})\.(\d{2})(?:.*?\((\d+)\))?/i.exec(base)
  if (wa) {
    const [_, y, m, d, hh, mm, ss, idx] = wa
    const parts = [
      'wa',
      `${y}${m}${d}`,
      `${hh}${mm}${ss}`,
      idx || ''
    ].filter(Boolean)
    return parts.join('-')
  }

  // Generic slug fallback
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
