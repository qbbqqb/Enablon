// Project constants
export const PROJECTS = ['CAMPUS', 'GVX03', 'GVX04', 'GVX05'] as const
export type Project = typeof PROJECTS[number]

// Room/Area options
export const ROOM_AREAS = [
  'AHU',
  'Battery Room',
  'Breakroom/Canteen',
  'Cleaner/Janitorial Stores',
  'COLO or AZ',
  'Corridor/Hallway/Spine',
  'Data Bearing Device',
  'DBD Shredding Room or Area',
  'Debox/Storage Room',
  'Designated Smoking Area',
  'Electrical Room',
  'External Area',
  'FOC',
  'FOC Stores',
  'FOC Workshop or Tool Room',
  'Generator Compound/Service Yard',
  'ITPAC',
  'Loading Bay or Dock',
  'MDF or IDF Room',
  'Office of Administrative Area',
  'Other',
  'Parking Lot/Car Park',
  'Restroom or Washroom',
  'Roof Area',
  'SOC',
  'Training Room',
  'Vendor Stores'
] as const
export type RoomArea = typeof ROOM_AREAS[number]

// Observation categories
export const OBSERVATION_CATEGORIES = [
  'New At Risk Observation',
  'New Near Miss',
  'New Positive Observation'
] as const
export type ObservationCategory = typeof OBSERVATION_CATEGORIES[number]

// Category types (mutually exclusive)
export const CATEGORY_TYPES = [
  'General Category',
  'HRA + Significant Exposure'
] as const
export type CategoryType = typeof CATEGORY_TYPES[number]

// HRA + Significant Exposure options
export const HRA_CATEGORIES = [
  'Confined Spaces',
  'Driving',
  'Electrical',
  'Energy Isolation',
  'Ground Disturbance',
  'Hazardous Materials',
  'Infectious Disease',
  'Lifting Operations',
  'Material Handling',
  'Mobile Equipment',
  'Noise',
  'Temperature Extremes',
  'Working from Heights'
] as const
export type HRACategory = typeof HRA_CATEGORIES[number]

// General Category options
export const GENERAL_CATEGORIES = [
  'Animals and Insects',
  'Barricades',
  'Biological',
  'Documentation',
  'Emergency Preparedness',
  'Environmental',
  'Ergonomic',
  'Fatigue',
  'Fire Protection',
  'Hand or Power Tools',
  'Housekeeping',
  'Lasers',
  'Lighting',
  'Line of Fire',
  'Logistics',
  'Manual Lifting',
  'Office Tools and Equipment',
  'Other',
  'Personal Protective Equipment',
  'Safety Culture',
  'Sanitation',
  'Site Access and Control',
  'Training',
  'Ventilation',
  'Walking, Working Surfaces',
  'Welding, Cutting and Grinding'
] as const
export type GeneralCategory = typeof GENERAL_CATEGORIES[number]

// Phase of Construction
export const CONSTRUCTION_PHASES = [
  'Cladding Building Envelope',
  'Commissioning',
  'Demolition',
  'Exterior Slabs & Equipment',
  'Foundations',
  'Integration',
  'Interior Fit-Out - CSA',
  'Interior Fit-Out - Electrical',
  'Interior Fit-Out - Mechanical',
  'Interior Slabs',
  'Interior Underground Services',
  'Network Fit-Out',
  'Roofing',
  'Security',
  'Site Clearing & Preparation',
  'Site Utility Services',
  'Steel Erection',
  'Tilt Wall Construction'
] as const
export type ConstructionPhase = typeof CONSTRUCTION_PHASES[number]

// Worst Potential Severity
export const SEVERITY_LEVELS = [
  'Major (1 Day)',
  'Potentially Serious/Serious (Immediate)',
  'Positive Observation',
  'Minor (7 Days)'
] as const
export type SeverityLevel = typeof SEVERITY_LEVELS[number]

// Project-specific mappings
export const PROJECT_MAPPINGS = {
  CAMPUS: {
    responsibleParty: 'alimberger B2B',
    personNotified: 'adoyle B2B'
  },
  GVX03: {
    responsibleParty: 'c-rthornton B2B',
    personNotified: 'dviorelsilion B2B'
  },
  GVX04: {
    responsibleParty: 'dbradbury B2B',
    personNotified: 'vferreira B2B'
  },
  GVX05: {
    responsibleParty: 'nmacaodha',
    personNotified: 'llaanemae B2B'
  }
} as const

// Constants
export const CONSTANTS = {
  COMMENTS: 'DCD Observation',
  MAX_FILES: 60,
  MAX_UPLOAD_SIZE: 200 * 1024 * 1024, // 200MB
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB per file after compression
  AI_BATCH_SIZE: 10, // Process more images per AI call
  AI_CONCURRENCY: 3, // Faster concurrent processing
  // Maximum quality for GC safety documentation (Railway optimized)
  IMAGE_MAX_DIMENSION: 2048, // Ultra-high detail for safety inspections
  IMAGE_QUALITY: 0.92, // Premium quality for professional documentation
  TIMEZONE: 'Europe/Stockholm'
} as const

// Quick image categorization rules
export const QUICK_RULES = {
  'cable drum without chocks': { type: 'HRA + Significant Exposure' as CategoryType, category: 'Material Handling' as HRACategory },
  'rebar without caps': { type: 'General Category' as CategoryType, category: 'Walking, Working Surfaces' as GeneralCategory },
  'barriers down': { type: 'General Category' as CategoryType, category: 'Barricades' as GeneralCategory },
  'broken feet': { type: 'General Category' as CategoryType, category: 'Barricades' as GeneralCategory },
  'poor housekeeping': { type: 'General Category' as CategoryType, category: 'Housekeeping' as GeneralCategory },
  'exposed pipe near traffic': { type: 'General Category' as CategoryType, category: 'Line of Fire' as GeneralCategory },
  'obstructed egress': { type: 'General Category' as CategoryType, category: 'Emergency Preparedness' as GeneralCategory }
} as const
