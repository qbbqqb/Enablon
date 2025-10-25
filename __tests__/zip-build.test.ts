import { createZipStream } from '@/lib/zip/buildZip'
import type { Observation, ObservationDraft, ProcessedImage } from '@/lib/types'

const createObservation = (overrides: Partial<ObservationDraft>): ObservationDraft => {
  const base: Record<string, unknown> = {
    Project: 'GVX04',
    'Room/Area': 'External Area',
    Comments: 'Comments',
    'Observation Category': 'New At Risk Observation',
    'Observation Description': 'External Area: Cable damage near panel',
    'Responsible Party': 'GC',
    'Interim Corrective Actions': 'N/A',
    'Final Corrective Actions': 'OPEN - GC to action.',
    'Category Type': 'General Category',
    'Phase of Construction': 'Integration',
    'Notification Date': '2025-01-15',
    'High Risk + Significant Exposure': '',
    'General Category': 'Housekeeping',
    'Worst Potential Severity': 'Minor (7 Days)',
    'Person Notified': 'John Smith',
    __photoIndices: []
  }

  return { ...(base as ObservationDraft), ...overrides }
}

const createImage = (originalIndex: number, originalName: string): ProcessedImage => ({
  originalIndex,
  originalName,
  buffer: Buffer.from(`image-${originalIndex}`),
  mimeType: 'image/jpeg'
})

describe('createZipStream photo naming', () => {
  it('builds simple sequential filenames (YYYYMMDD-HHMM-###.jpg)', () => {
    const observation1 = createObservation({
      __photoIndices: [1, 2]
    })

    const observation2 = createObservation({
      Project: 'GVX03',
      'Room/Area': 'COLO1',
      'Category Type': 'HRA + Significant Exposure',
      'High Risk + Significant Exposure': 'Electrical Contact',
      'General Category': '',
      'Worst Potential Severity': 'Major (1 Day)',
      'Notification Date': '2025-01-16',
      'Observation Description': 'COLO1: Proper PPE in electrical room',
      __photoIndices: [3]
    })

    const images: ProcessedImage[] = [
      createImage(0, 'IMG_0001.JPG'),
      createImage(1, 'IMG_0002.JPG'),
      createImage(2, 'IMG_0003.JPG')
    ]

    const photoNames = {
      1: 'damaged-cable',
      2: 'damaged-cable-second',
      3: 'ppe-compliance'
    }

    const { manifest } = createZipStream({
      observations: [observation1, observation2] as unknown as Observation[],
      images,
      project: 'GVX04',
      failed: [],
      photoNames
    })

    expect(manifest).toHaveLength(3)
    // Simple sequential naming: YYYYMMDD-HHMM-###.jpg
    expect(manifest[0].renamedFilename).toMatch(/^\d{8}-\d{4}-001\.jpg$/)
    expect(manifest[1].renamedFilename).toMatch(/^\d{8}-\d{4}-002\.jpg$/)
    expect(manifest[2].renamedFilename).toMatch(/^\d{8}-\d{4}-003\.jpg$/)
    
    // All photos have rowNumber 0 (not tied to observation rows)
    expect(manifest[0].rowNumber).toBe(0)
    expect(manifest[1].rowNumber).toBe(0)
    expect(manifest[2].rowNumber).toBe(0)
    
    // Original filenames preserved in manifest
    expect(manifest[0].originalFilename).toBe('IMG_0001.JPG')
    expect(manifest[1].originalFilename).toBe('IMG_0002.JPG')
    expect(manifest[2].originalFilename).toBe('IMG_0003.JPG')
  })

  it('includes all photos regardless of observation mapping', () => {
    const observation = createObservation({
      __photoIndices: [1]
    })

    const orphanImage = createImage(5, 'extra-photo.jpg')

    const { manifest } = createZipStream({
      observations: [observation] as unknown as Observation[],
      images: [createImage(0, 'IMG_0001.JPG'), orphanImage],
      project: 'GVX04',
      failed: [],
      photoNames: { 1: 'housekeeping-check' }
    })

    expect(manifest).toHaveLength(2)
    // Second photo gets sequential naming
    expect(manifest[1].renamedFilename).toMatch(/^\d{8}-\d{4}-002\.jpg$/)
    expect(manifest[1].rowNumber).toBe(0)
    expect(manifest[1].originalFilename).toBe('extra-photo.jpg')
    expect(manifest[1].observationDescription).toBe('Photo included in batch upload')
  })
})
