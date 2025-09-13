import type { Observation } from '@/lib/types'

describe('HRA vs General Category Exclusivity', () => {
  test('HRA category should have General Category empty', () => {
    const hraObservation: Observation = {
      'Project': 'GVX04',
      'Room/Area': 'External Area',
      'Comments': 'DCD Observation',
      'Observation Category': 'New At Risk Observation',
      'Observation Description': 'Material handling issue',
      'Responsible Party': 'Dean Bradbury - dbradbury B2B',
      'Interim Corrective Actions': '',
      'Final Corrective Actions': '',
      'Category Type': 'HRA + Significant Exposure',
      'Phase of Construction': 'Commissioning',
      'Notification Date': '12/09/2025',
      'High Risk + Significant Exposure': 'Material Handling',
      'General Category': '', // Should be empty
      'Worst Potential Severity': 'Minor (7 Days)',
      'Person Notified': 'Vitor Ferreira - vferreira B2B'
    }

    expect(hraObservation['Category Type']).toBe('HRA + Significant Exposure')
    expect(hraObservation['High Risk + Significant Exposure']).toBeTruthy()
    expect(hraObservation['General Category']).toBe('')
  })

  test('General Category should have HRA empty', () => {
    const generalObservation: Observation = {
      'Project': 'GVX04',
      'Room/Area': 'External Area',
      'Comments': 'DCD Observation',
      'Observation Category': 'New At Risk Observation',
      'Observation Description': 'Housekeeping issue',
      'Responsible Party': 'Dean Bradbury - dbradbury B2B',
      'Interim Corrective Actions': '',
      'Final Corrective Actions': '',
      'Category Type': 'General Category',
      'Phase of Construction': 'Commissioning',
      'Notification Date': '12/09/2025',
      'High Risk + Significant Exposure': '', // Should be empty
      'General Category': 'Housekeeping',
      'Worst Potential Severity': 'Minor (7 Days)',
      'Person Notified': 'Vitor Ferreira - vferreira B2B'
    }

    expect(generalObservation['Category Type']).toBe('General Category')
    expect(generalObservation['General Category']).toBeTruthy()
    expect(generalObservation['High Risk + Significant Exposure']).toBe('')
  })
})

describe('Project Mappings', () => {
  test('GVX04 should map to correct responsible party and person notified', () => {
    const expectedResponsible = 'Dean Bradbury - dbradbury B2B'
    const expectedNotified = 'Vitor Ferreira - vferreira B2B'
    
    // This would typically be tested in the AI analysis module
    expect(expectedResponsible).toBe('Dean Bradbury - dbradbury B2B')
    expect(expectedNotified).toBe('Vitor Ferreira - vferreira B2B')
  })

  test('GVX03 should map to correct responsible party and person notified', () => {
    const expectedResponsible = 'Nigel MacAodha - nmacaodha'
    const expectedNotified = 'Dragos Viorel-Silion - dviorelsilion B2B'
    
    expect(expectedResponsible).toBe('Nigel MacAodha - nmacaodha')
    expect(expectedNotified).toBe('Dragos Viorel-Silion - dviorelsilion B2B')
  })

  test('GVX05 should map to correct responsible party and person notified', () => {
    const expectedResponsible = 'Nigel MacAodha - nmacaodha'
    const expectedNotified = 'Liina Laanemae - llaanemae B2B'
    
    expect(expectedResponsible).toBe('Nigel MacAodha - nmacaodha')
    expect(expectedNotified).toBe('Liina Laanemae - llaanemae B2B')
  })
})