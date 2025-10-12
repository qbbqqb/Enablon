import type { ProcessedImage, FailedItem, Observation } from '@/lib/types'
import type { Project } from '@/lib/constants/enums'
import type { ObservationShell } from '@/lib/notes/extractShells'

const SESSION_TTL_MS = 15 * 60 * 1000 // 15 minutes

interface SessionData {
  projectFallback: Project
  failed: FailedItem[]
  images: Record<string, ProcessedImage>
  order: string[]
  observations: Observation[]
  observationShells?: ObservationShell[] // For photo assignment workflow
  photoNames?: Record<number, string> // AI-generated photo names
  createdAt: number
}

const globalSession = globalThis as typeof globalThis & {
  __enablonSessionStore__?: Map<string, SessionData>
}

const sessionStore = globalSession.__enablonSessionStore__ ?? new Map<string, SessionData>()

if (!globalSession.__enablonSessionStore__) {
  globalSession.__enablonSessionStore__ = sessionStore
}

export function setSessionData(sessionId: string, data: Omit<SessionData, 'createdAt'>) {
  const sessionData = {
    ...data,
    createdAt: Date.now()
  }
  sessionStore.set(sessionId, sessionData)

  console.log(`📦 Session stored: ${sessionId}`)
  console.log(`   - Images: ${Object.keys(sessionData.images).length}`)
  console.log(`   - Observation shells: ${sessionData.observationShells?.length || 0}`)
  console.log(`   - Observations: ${sessionData.observations.length}`)
  console.log(`   - Total sessions in store: ${sessionStore.size}`)
}

export function getSessionData(sessionId: string): SessionData | undefined {
  console.log(`🔍 Retrieving session: ${sessionId}`)
  console.log(`   - Total sessions in store: ${sessionStore.size}`)

  const data = sessionStore.get(sessionId)
  if (!data) {
    console.log(`   - ❌ Session not found`)
    return undefined
  }

  const age = Date.now() - data.createdAt
  const ageMinutes = Math.floor(age / 1000 / 60)

  if (age > SESSION_TTL_MS) {
    console.log(`   - ❌ Session expired (${ageMinutes} minutes old, TTL is 15 minutes)`)
    sessionStore.delete(sessionId)
    return undefined
  }

  console.log(`   - ✅ Session found (${ageMinutes} minutes old)`)
  return data
}

export function clearSessionData(sessionId: string) {
  sessionStore.delete(sessionId)
}
