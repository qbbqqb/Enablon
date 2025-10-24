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
})
