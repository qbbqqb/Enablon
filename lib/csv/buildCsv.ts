import type { Observation } from '../types'
import { CSV_HEADERS } from '../constants/headers'

export function buildCSV(observations: Observation[]): string {
  // Start with UTF-8 BOM
  let csv = '\uFEFF'
  
  // Add headers
  csv += CSV_HEADERS.map(header => escapeCSVField(header)).join(',') + '\r\n'
  
  // Add data rows
  for (const obs of observations) {
    const row = CSV_HEADERS.map(header => {
      const value = obs[header as keyof Observation]
      return escapeCSVField(String(value))
    })
    csv += row.join(',') + '\r\n'
  }
  
  return csv
}

function escapeCSVField(field: string): string {
  // Handle null/undefined
  if (field == null) {
    return ''
  }
  
  const str = String(field)
  
  // If field contains comma, double quote, or newline, wrap in quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    // Escape internal quotes by doubling them
    const escaped = str.replace(/"/g, '""')
    return `"${escaped}"`
  }
  
  return str
}

export function validateCSVHeaders(): boolean {
  const expectedHeaders = [
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
  
  if (CSV_HEADERS.length !== expectedHeaders.length) {
    return false
  }
  
  for (let i = 0; i < CSV_HEADERS.length; i++) {
    if (CSV_HEADERS[i] !== expectedHeaders[i]) {
      return false
    }
  }
  
  return true
}