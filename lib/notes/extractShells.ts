/**
 * Extract observation shells from numbered notes
 *
 * Parses notes like:
 *   1. Location: Description
 *   2. Location: Description
 *
 * Returns observation shells ready for photo assignment
 */

export interface ObservationShell {
  id: number
  notePreview: string
  fullNote: string
}

const UNICODE_WORD_JOINER = '\u2060' // Zero-width character sometimes present

export function extractObservationShells(notes: string): ObservationShell[] {
  if (!notes || !notes.trim()) {
    return []
  }

  // Clean unicode artifacts
  const cleanedNotes = notes.replace(new RegExp(UNICODE_WORD_JOINER, 'g'), '')

  // Split by newlines and process each line
  const lines = cleanedNotes.split('\n').map(line => line.trim()).filter(Boolean)

  const shells: ObservationShell[] = []

  for (const line of lines) {
    // Match patterns like "1. Note text" or "1) Note text"
    const match = line.match(/^(\d+)[\.\)]\s*(.+)$/)

    if (match) {
      const id = parseInt(match[1], 10)
      const noteText = match[2].trim()

      if (noteText) {
        // Create preview (first 100 chars)
        const preview = noteText.length > 100
          ? noteText.substring(0, 97) + '...'
          : noteText

        shells.push({
          id,
          notePreview: preview,
          fullNote: noteText
        })
      }
    }
  }

  console.log(`Extracted ${shells.length} observation shells from notes`)
  return shells
}
