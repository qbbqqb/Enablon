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
  it('builds observation-driven filenames with per-observation suffixes', () => {
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
    expect(manifest[0].renamedFilename).toBe(
      'GVX04-001-External-Area-Housekeeping-Minor-20250115-damaged-cable-1.jpg'
    )
    expect(manifest[1].renamedFilename).toBe(
      'GVX04-001-External-Area-Housekeeping-Minor-20250115-damaged-cable-second-2.jpg'
    )
    expect(manifest[2].renamedFilename).toBe(
      'GVX03-002-COLO1-Electrical-Contact-Major-20250116-ppe-compliance.jpg'
    )
  })

  it('falls back gracefully when no observation mapping exists', () => {
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
    expect(manifest[1].renamedFilename).toMatch(/^GVX04-000-\d{8}-extra-photo\.jpg$/)
    expect(manifest[1].rowNumber).toBe(0)
  })
})
