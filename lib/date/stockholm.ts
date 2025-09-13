import { CONSTANTS } from '../constants/enums'

export function getStockholmDate(): string {
  const now = new Date()
  
  // Create a date formatter for Europe/Stockholm timezone
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: CONSTANTS.TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
  
  const parts = formatter.formatToParts(now)
  const year = parts.find(part => part.type === 'year')?.value
  const month = parts.find(part => part.type === 'month')?.value
  const day = parts.find(part => part.type === 'day')?.value
  
  // Return in DD/MM/YYYY format
  return `${day}/${month}/${year}`
}