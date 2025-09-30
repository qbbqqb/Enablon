import type { ProcessedImage, FailedItem, Observation } from '@/lib/types'
import type { Project } from '@/lib/constants/enums'

const SESSION_TTL_MS = 15 * 60 * 1000 // 15 minutes

interface SessionData {
  projectFallback: Project
  failed: FailedItem[]
  images: Record<string, ProcessedImage>
  order: string[]
  observations: Observation[]
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
  sessionStore.set(sessionId, {
    ...data,
    createdAt: Date.now()
  })
}

export function getSessionData(sessionId: string): SessionData | undefined {
  const data = sessionStore.get(sessionId)
  if (!data) return undefined

  if (Date.now() - data.createdAt > SESSION_TTL_MS) {
    sessionStore.delete(sessionId)
    return undefined
  }

  return data
}

export function clearSessionData(sessionId: string) {
  sessionStore.delete(sessionId)
}
