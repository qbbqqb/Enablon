import type { ProcessedImage, FailedItem } from '@/lib/types'
import type { Project } from '@/lib/constants/enums'

const SESSION_TTL_MS = 15 * 60 * 1000 // 15 minutes

interface SessionData {
  project: Project
  failed: FailedItem[]
  images: Record<string, ProcessedImage>
  order: string[]
  createdAt: number
}

const sessionStore = new Map<string, SessionData>()

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
