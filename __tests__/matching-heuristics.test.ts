import { __testHelpers } from '@/lib/ai/agents'

describe('matchPhotosToNotes affinity', () => {
  const { matchPhotosToNotes } = __testHelpers

  it('reorders photos for numbered notes based on token affinity', async () => {
    const photos = [
      {
        photoId: 1,
        location: 'Outdoor laydown area near COLO3',
        equipment: ['pallet stacks'],
        people: [],
        safetyIssues: ['materials blocking walkway', 'trip hazard'],
        conditions: ['gravel ground'],
        confidence: 'high',
        sentiment: 'problem',
        originalName: 'photo1.jpg'
      },
      {
        photoId: 2,
        location: 'Electrical room COLO2 cell1',
        equipment: ['power cables'],
        people: [],
        safetyIssues: ['damaged cable insulation'],
        conditions: ['indoor'],
        confidence: 'high',
        sentiment: 'problem',
        originalName: 'photo2.jpg'
      }
    ] as any

    const notes = [
      {
        noteId: 1,
        originalText: '1. COLO2 cell1 electrical room - Cable damage noted on supply line.',
        location: 'COLO2 cell1 electrical room',
        issueType: 'electrical',
        keywords: ['cable', 'damage', 'electrical'],
        requiredElements: ['cable', 'electrical'],
        isPositive: false
      },
      {
        noteId: 2,
        originalText: '2. External laydown area - Materials stored blocking walkway.',
        location: 'external laydown area',
        issueType: 'housekeeping',
        keywords: ['materials', 'walkway', 'blocking'],
        requiredElements: ['barrier'],
        isPositive: false
      }
    ] as any

    const assignments = await matchPhotosToNotes(photos, notes, 'test-key')

    const assignmentMap = new Map(assignments.map(a => [a.noteId, a.photoIds]))

    expect(assignmentMap.get(1)).toEqual([2])
    expect(assignmentMap.get(2)).toEqual([1])
  })

  it('uses best available affinity match when scores are weak but informative', async () => {
    const photos = [
      {
        photoId: 1,
        location: 'Main corridor near welfare boards',
        equipment: ['notice boards'],
        people: [],
        safetyIssues: ['materials stored on floor'],
        conditions: ['indoor corridor'],
        confidence: 'high',
        sentiment: 'problem',
        originalName: 'photo1.jpg'
      },
      {
        photoId: 2,
        location: 'Storage bay',
        equipment: ['podium ladder'],
        people: [],
        safetyIssues: ['ladder left unsecured'],
        conditions: ['indoor storage'],
        confidence: 'high',
        sentiment: 'problem',
        originalName: 'photo2.jpg'
      }
    ] as any

    const notes = [
      {
        noteId: 1,
        originalText: '1. Podium ladder stored unsecured. Chain the ladder to prevent unauthorised use.',
        location: 'General access walkway',
        issueType: 'working_at_height',
        keywords: ['podium', 'ladder', 'unsecured'],
        requiredElements: [],
        isPositive: false
      },
      {
        noteId: 2,
        originalText: '2. Materials blocking the main corridor near the welfare boards.',
        location: 'Main corridor',
        issueType: 'housekeeping',
        keywords: ['materials', 'corridor', 'blocking'],
        requiredElements: [],
        isPositive: false
      }
    ] as any

    const assignments = await matchPhotosToNotes(photos, notes, 'test-key')

    const assignmentMap = new Map(assignments.map(a => [a.noteId, a.photoIds]))

    expect(assignmentMap.get(1)).toEqual([2])
    expect(assignmentMap.get(2)).toEqual([1])
  })

  it('attaches leftover photos using secondary affinity', async () => {
    const photos = [
      {
        photoId: 1,
        location: 'Main corridor near signage',
        equipment: [],
        people: [],
        safetyIssues: ['walkway blocked'],
        conditions: ['indoor'],
        confidence: 'high',
        sentiment: 'problem',
        originalName: 'photo1.jpg'
      },
      {
        photoId: 2,
        location: 'Cutting station',
        equipment: ['signage'],
        people: [],
        safetyIssues: ['missing ppe'],
        conditions: ['indoor'],
        confidence: 'high',
        sentiment: 'problem',
        originalName: 'photo2.jpg'
      },
      {
        photoId: 3,
        location: 'Main corridor walkway',
        equipment: [],
        people: [],
        safetyIssues: ['materials in walkway'],
        conditions: ['indoor'],
        confidence: 'medium',
        sentiment: 'problem',
        originalName: 'photo3.jpg'
      }
    ] as any

    const notes = [
      {
        noteId: 1,
        originalText: '1. Corridor: Materials stored in main corridor obstructing walkway.',
        location: 'main corridor',
        issueType: 'housekeeping',
        keywords: ['materials', 'walkway', 'corridor'],
        requiredElements: [],
        isPositive: false
      },
      {
        noteId: 2,
        originalText: '2. Cutting station: Missing PPE signage.',
        location: 'cutting station',
        issueType: 'welding',
        keywords: ['signage', 'ppe'],
        requiredElements: [],
        isPositive: false
      }
    ] as any

    const assignments = await matchPhotosToNotes(photos, notes, 'test-key')

    const map = new Map(assignments.map(a => [a.noteId, a.photoIds]))
    expect(map.get(1)).toEqual(expect.arrayContaining([1, 3]))
    expect(map.get(2)).toEqual([2])
  })

  it('forces fallback attachment when affinity scores are negligible', async () => {
    const photos = [
      {
        photoId: 1,
        location: 'Generic workspace',
        equipment: [],
        people: [],
        safetyIssues: ['trip hazard'],
        conditions: [],
        confidence: 'medium',
        sentiment: 'problem',
        originalName: 'photo1.jpg'
      },
      {
        photoId: 2,
        location: 'Generic workspace',
        equipment: [],
        people: [],
        safetyIssues: ['poor housekeeping'],
        conditions: [],
        confidence: 'medium',
        sentiment: 'problem',
        originalName: 'photo2.jpg'
      },
      {
        photoId: 3,
        location: 'Generic workspace',
        equipment: [],
        people: [],
        safetyIssues: [],
        conditions: [],
        confidence: 'low',
        sentiment: 'problem',
        originalName: 'photo3.jpg'
      }
    ] as any

    const notes = [
      {
        noteId: 1,
        originalText: '1. Trip hazard noted in workspace.',
        location: 'workspace',
        issueType: 'housekeeping',
        keywords: ['trip', 'hazard'],
        requiredElements: [],
        isPositive: false
      }
    ] as any

    const assignments = await matchPhotosToNotes(photos, notes, 'test-key')
    const map = new Map(assignments.map(a => [a.noteId, a.photoIds]))
    expect(map.get(1)).toEqual(expect.arrayContaining([1, 2, 3]))
  })
})
