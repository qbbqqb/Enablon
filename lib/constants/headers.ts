// Exact CSV headers in the required order for Enablon/Compass compliance
export const CSV_HEADERS = [
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
] as const

export type CSVHeaders = typeof CSV_HEADERS[number]