import { generateSimplePhotoNames } from '@/lib/ai/agents'
import type { ProcessedImage } from '@/lib/types'

describe('generateSimplePhotoNames', () => {
  const originalFetch = global.fetch

  const createImage = (index: number, name: string): ProcessedImage => ({
    originalIndex: index,
    originalName: name,
    buffer: Buffer.from(''),
    mimeType: 'image/jpeg'
  })

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-key'
  })

  afterEach(() => {
    global.fetch = originalFetch
    delete process.env.OPENROUTER_API_KEY
    jest.resetAllMocks()
  })

  it('sanitizes, validates, and deduplicates AI suggestions', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '[{"photoId":1,"suggestedName":"Blocked Fire Exit!!!"},{"photoId":2,"suggestedName":"blocked fire exit"},{"photoId":3,"suggestedName":""}]'
            }
          }
        ]
      })
    }

    global.fetch = jest.fn().mockResolvedValue(mockResponse as unknown)

    const images: ProcessedImage[] = [
      createImage(0, 'IMG_0001.JPG'),
      createImage(1, 'IMG_0002.JPG'),
      createImage(2, 'IMG_0003.JPG')
    ]

    const observations = [
      { 'Observation Description': 'Fire exit blocked by materials' },
      { 'Observation Description': 'Fire exit still blocked by materials' },
      { 'Observation Description': 'Cable damage at panel requires repair' }
    ]

    const result = await generateSimplePhotoNames(images, observations)

    expect(result[1]).toBe('blocked-fire-exit')
    expect(result[2]).toBe('blocked-fire-exit-still')
    expect(result[3]).toBe('cable-damage-panel-requires')
  })

  it('repairs malformed JSON responses and applies fallbacks', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '```json\n[{"photoId":1,"suggestedName":"Trailing comma",},{"photoId":2,"suggestedName":"ok"}]\n```'
            }
          }
        ]
      })
    }

    global.fetch = jest.fn().mockResolvedValue(mockResponse as unknown)

    const images: ProcessedImage[] = [
      createImage(0, 'first.jpg'),
      createImage(1, 'second.jpg')
    ]

    const observations = [
      { 'Observation Description': 'Trailing comma hazard noted' },
      { 'Observation Description': 'General housekeeping compliance' }
    ]

    const result = await generateSimplePhotoNames(images, observations)

    expect(result[1]).toBe('trailing-comma')
    expect(result[2]).toBe('housekeeping-compliance')
  })
})
