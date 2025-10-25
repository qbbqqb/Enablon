import type { 
  Project, 
  RoomArea, 
  ObservationCategory, 
  CategoryType,
  HRACategory,
  GeneralCategory, 
  ConstructionPhase,
  SeverityLevel 
} from './constants/enums'

export interface Observation {
  'Project': Project
  'Room/Area': RoomArea
  'Comments': string
  'Observation Category': ObservationCategory
  'Observation Description': string
  'Responsible Party': string
  'Interim Corrective Actions': string
  'Final Corrective Actions': string
  'Category Type': CategoryType
  'Phase of Construction': ConstructionPhase
  'Notification Date': string
  'High Risk + Significant Exposure': HRACategory | ''
  'General Category': GeneralCategory | ''
  'Worst Potential Severity': SeverityLevel
  'Person Notified': string
}

export type ObservationDraft = Observation & {
  __photoToken?: string
  __photoTokens?: string[]
  __aiFilename?: string  // AI-generated short filename based on photo content (deprecated, use __aiFilenames)
  __aiFilenames?: string[]  // Array of AI-generated filenames, one per photo
  __photoIndices?: number[]  // 1-based indices of photos that belong to this observation
}

export interface ProcessedImage {
  originalIndex: number
  originalName: string
  buffer: Buffer
  mimeType: string
  visualContent?: {
    location: string
    equipment: string[]
    safetyIssues: string[]
    sentiment: string
  }
  originalFilenameHints?: {
    project?: string        // e.g., "GVX04", "GVX05"
    location?: string       // e.g., "COLO", "Laydown", "Corridor"
    primarySubject?: string // e.g., "MaterialStorage", "CuttingStation"
    secondarySubject?: string // e.g., "ObstructedWalkway", "Unstable"
    sentiment?: 'positive' | 'negative' | 'neutral' // e.g., "Positive" in filename
    rawParts: string[]      // Original filename parts for debugging
  }
}

export interface ManifestEntry {
  rowNumber: number
  originalFilename: string
  renamedFilename: string
  observationDescription: string
}

export interface FailedItem {
  originalFilename: string
  reason: string
  step: 'upload' | 'processing' | 'ai_analysis' | 'schema_validation' | 'photo_assignment' | 'photo_retrieval' | 'ai_enrichment'
}

export interface ProcessingResult {
  observations: Observation[]
  images: ProcessedImage[]
  manifest: ManifestEntry[]
  failed: FailedItem[]
}
