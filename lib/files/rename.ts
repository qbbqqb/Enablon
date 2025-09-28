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

  // Contextual slug derived from room area, category, and description
  const description = generateContextSlug(observation, 45)

  // Date (YYYYMMDD)
  const dateParts = observation['Notification Date'].split('/')
  const dateStr = `${dateParts[2]}${dateParts[1]}${dateParts[0]}` // DD/MM/YYYY -> YYYYMMDD

  // Photo number for multiple photos per observation
  const photoNum = photoIndex > 1 ? `-${photoIndex}` : ''

  // Format: PROJECT-OBSNO-DESCRIPTION-DATE
  return `${project}-${obsNoStr}-${description}-${dateStr}${photoNum}.jpg`
}

function tokenize(value: string, min = 3, max = 14): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length >= min && word.length <= max)
}

function generateContextSlug(observation: Observation, maxLength: number): string {
  const tokens: string[] = []

  const pushTokens = (candidates: string[]) => {
    for (const candidate of candidates) {
      if (!candidate) continue
      if (tokens.includes(candidate)) continue
      tokens.push(candidate)
    }
  }

  pushTokens(tokenize(observation['Room/Area']))

  if (observation['Observation Category'] === 'New Positive Observation') {
    pushTokens(['positive'])
  } else {
    pushTokens(['atrisk'])
  }

  if (observation['High Risk + Significant Exposure']) {
    pushTokens(tokenize(observation['High Risk + Significant Exposure']))
  }

  if (observation['General Category']) {
    pushTokens(tokenize(observation['General Category']))
  }

  pushTokens(tokenize(observation['Observation Description']))

  const slug = tokens
    .join('-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  if (!slug) {
    return 'observation'
  }

  if (slug.length <= maxLength) {
    return slug
  }

  const truncated = slug.substring(0, maxLength)
  return truncated.replace(/-[^-]*$/, '') || truncated.replace(/-+$/, '') || 'observation'
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
