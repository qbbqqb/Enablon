import { buildCSV, validateCSVHeaders } from '@/lib/csv/buildCsv'
import { CSV_HEADERS } from '@/lib/constants/headers'
import type { Observation } from '@/lib/types'

describe('CSV Generation', () => {
  test('validateCSVHeaders returns true for correct headers', () => {
    expect(validateCSVHeaders()).toBe(true)
  })

  test('CSV headers are in correct order', () => {
    const expectedOrder = [
      'Project',
      'Room/Area', 
      'Comments',
      'Observation Category',
      'Observation Description',
      'Responsible Party',
      'Interim Corrective Actions',
      'Final Corrective Actions',
      'Category Type',
      'Phase of Construction',
      'Notification Date',
      'High Risk + Significant Exposure',
      'General Category',
      'Worst Potential Severity',
      'Person Notified'
    ]
    
    expect(CSV_HEADERS).toEqual(expectedOrder)
  })

  test('buildCSV generates correct format with BOM and CRLF', () => {
    const mockObservation: Observation = {
      'Project': 'GVX04',
      'Room/Area': 'External Area',
      'Comments': 'DCD Observation',
      'Observation Category': 'New At Risk Observation',
      'Observation Description': 'Test observation description',
      'Responsible Party': 'Dean Bradbury - dbradbury B2B',
      'Interim Corrective Actions': '',
      'Final Corrective Actions': '',
      'Category Type': 'General Category',
      'Phase of Construction': 'Commissioning',
      'Notification Date': '12/09/2025',
      'High Risk + Significant Exposure': '',
      'General Category': 'Housekeeping',
      'Worst Potential Severity': 'Minor (7 Days)',
      'Person Notified': 'Vitor Ferreira - vferreira B2B'
    }

    const csv = buildCSV([mockObservation])
    
    // Should start with UTF-8 BOM
    expect(csv.charCodeAt(0)).toBe(0xFEFF)
    
    // Should use CRLF line endings
    expect(csv.includes('\r\n')).toBe(true)
    
    // Should contain headers
    expect(csv).toContain('Project,Room/Area,Comments')
    
    // Should contain data
    expect(csv).toContain('GVX04,External Area,DCD Observation')
  })

  test('buildCSV escapes fields with commas and quotes', () => {
    const mockObservation: Observation = {
      'Project': 'GVX04',
      'Room/Area': 'External Area',
      'Comments': 'DCD Observation',
      'Observation Category': 'New At Risk Observation',
      'Observation Description': 'Test with, comma and "quotes"',
      'Responsible Party': 'Dean Bradbury - dbradbury B2B',
      'Interim Corrective Actions': '',
      'Final Corrective Actions': '',
      'Category Type': 'General Category',
      'Phase of Construction': 'Commissioning',
      'Notification Date': '12/09/2025',
      'High Risk + Significant Exposure': '',
      'General Category': 'Housekeeping',
      'Worst Potential Severity': 'Minor (7 Days)',
      'Person Notified': 'Vitor Ferreira - vferreira B2B'
    }

    const csv = buildCSV([mockObservation])
    
    // Field with comma and quotes should be escaped
    expect(csv).toContain('"Test with, comma and ""quotes"""')
  })
})