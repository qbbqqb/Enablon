import type { Observation } from '../types'
import type { Project } from '../constants/enums'

/**
 * Generate simple sequential photo filename with date and time
 * Format: YYYYMMDD-HHMM-###.jpg
 * 
 * Example: 20251024-1430-001.jpg
 * 
 * @param date - Date object for the upload
 * @param index - 1-based photo index (1, 2, 3...)
 * @returns Filename like "20251024-1430-001.jpg"
 */
export function generateSimpleSequentialName(
  date: Date,
  index: number
): string {
  // Format date as YYYYMMDD
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const dateStr = `${year}${month}${day}`
  
  // Format time as HHMM
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const timeStr = `${hours}${minutes}`
  
  // Pad index to 3 digits (001, 002, ...)
  const paddedIndex = String(index).padStart(3, '0')
  
  return `${dateStr}-${timeStr}-${paddedIndex}.jpg`
}

export function generatePhotoFilename(
  project: Project,
  obsNo: number,
  observation: Observation,
  photoIndex: number = 1,
  aiGeneratedName?: string
): string {
  // If AI generated a short filename, use it directly
  if (aiGeneratedName) {
    const cleanName = aiGeneratedName
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .trim()
      .substring(0, 60)

    return cleanName.endsWith('.jpg') ? cleanName : `${cleanName}.jpg`
  }

  // Fallback: use observation description
  const description = observation['Observation Description'] || 'Observation'
  const cleanDescription = description
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 60)
    .replace(/\s+/g, '-')

  const photoSuffix = photoIndex > 1 ? `-${photoIndex}` : ''
  return `${cleanDescription}${photoSuffix}.jpg`
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

const ISSUE_STOP_WORDS = new Set([
  ...STOP_WORDS,
  'the',
  'and',
  'area',
  'materials',
  'material',
  'hazard',
  'equipment',
  'people',
  'worker',
  'workers',
  'poor',
  'lack',
  'with',
  'without',
  'unsafe',
  'housekeeping',
  'storage',
  'site',
  'room',
  'near',
  'around',
  'located',
  'observed',
  'noted'
])

const OBS_PHOTO_STOP_WORDS = new Set([
  'project',
  'area',
  'room',
  'cell',
  'colo',
  'engineering',
  'company',
  'limited',
  'contractor',
  'subcontractor',
  'location',
  'observed',
  'inspection',
  'site',
  'general',
  'category',
  'observation',
  'photo',
  'image',
  'jpeg',
  'jpg'
])

const OBS_PHOTO_WORD_LIMIT = 4

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

function buildIssueSegment(source: string | undefined, fallback: string): string {
  const tokens = (source?.match(/[A-Za-z0-9]+/g) ?? []).map(token => token.trim()).filter(Boolean)
  if (tokens.length === 0) {
    return fallback
  }

  const selected: string[] = []
  const used = new Set<string>()

  for (const token of tokens) {
    const normalized = token.toLowerCase()
    if (ISSUE_STOP_WORDS.has(normalized) || normalized.length <= 2) {
      continue
    }
    if (used.has(normalized)) {
      continue
    }
    used.add(normalized)
    selected.push(truncateSegment(formatSegment(token), 12))
    if (selected.length === 2) {
      break
    }
  }

  if (selected.length === 0) {
    return fallback
  }

  const combined = selected.join('-')
  return combined.length <= 26 ? combined : combined.slice(0, 26).replace(/-+$/, '')
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

// Generate simple descriptive slug from observation description for photo filenames
export function generateSimplePhotoSlug(description: string): string {
  // "COLO2 CELL1 Electrical room: Cable damage creating electrical hazard"
  // → "cable-damage"

  // Remove location prefix (everything before colon)
  const content = description.includes(':')
    ? description.split(':').slice(1).join(':').trim()
    : description

  // Extract keywords (skip common words)
  const tokens = content
    .toLowerCase()
    .match(/[a-z0-9]+/g) || []

  const keywords = tokens
    .filter(token => {
      return !ISSUE_STOP_WORDS.has(token) && token.length > 3
    })
    .slice(0, 4) // Max 4 keywords

  const slug = keywords.join('-').substring(0, 40)
  return slug || 'observation'
}

function toObservationTokens(input: string): string[] {
  const normalized = input
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9\s-]/g, ' ')
    .replace(/-/g, ' ')
    .toLowerCase()
  const rawTokens = normalized.split(/\s+/).filter(Boolean)

  const tokens: string[] = []
  const seen = new Set<string>()

  for (const token of rawTokens) {
    if (OBS_PHOTO_STOP_WORDS.has(token)) {
      continue
    }
    if (token.length <= 2) {
      continue
    }
    if (seen.has(token)) {
      continue
    }
    seen.add(token)
    tokens.push(token)
  }

  return tokens
}

function buildSlugFromTokens(tokens: string[]): string {
  const limited = tokens.slice(0, OBS_PHOTO_WORD_LIMIT)
  return limited.join('-')
}

function sanitizeSlug(slug: string): string {
  return slug
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

export function buildObservationPhotoSlug(options: {
  aiName?: string
  description?: string
  originalName?: string
}): string {
  const { aiName, description, originalName } = options

  const candidates: string[] = []

  if (aiName) {
    candidates.push(aiName)
  }

  if (description) {
    const content = description.includes(':')
      ? description.split(':').slice(1).join(':').trim()
      : description
    candidates.push(content)
  }

  if (originalName) {
    candidates.push(originalName)
  }

  let fallbackSlug = ''

  for (const candidate of candidates) {
    const tokens = toObservationTokens(candidate)
    if (tokens.length === 0) {
      continue
    }
    const slug = sanitizeSlug(buildSlugFromTokens(tokens))
    if (!slug) {
      continue
    }

    if (tokens.length >= 2) {
      return slug
    }

    if (!fallbackSlug) {
      fallbackSlug = slug
    }
  }

  return fallbackSlug || 'observation'
}
