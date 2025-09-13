interface ProgressEvent {
  id: string
  progress: number
  label: string
  step: string
  details?: {
    processed?: number
    total?: number
    batchIndex?: number
    totalBatches?: number
  }
}

// Store active connections
const connections = new Map<string, ReadableStreamDefaultController<any>>()
const progressData = new Map<string, ProgressEvent>()

// Function to register a connection
export function registerProgressConnection(sessionId: string, controller: ReadableStreamDefaultController<any>) {
  connections.set(sessionId, controller)
}

// Function to send progress updates (called from other API routes)
export function sendProgressUpdate(sessionId: string, progress: ProgressEvent) {
  const controller = connections.get(sessionId)
  progressData.set(sessionId, progress)

  if (controller) {
    try {
      const message = `data: ${JSON.stringify(progress)}\n\n`
      controller.enqueue(new TextEncoder().encode(message))
    } catch (error) {
      console.error('Error sending progress update:', error)
      // Clean up failed connection
      connections.delete(sessionId)
      progressData.delete(sessionId)
    }
  }
}

// Function to get existing progress
export function getExistingProgress(sessionId: string): ProgressEvent | undefined {
  return progressData.get(sessionId)
}

// Function to close connection
export function closeProgressConnection(sessionId: string) {
  const controller = connections.get(sessionId)
  if (controller) {
    try {
      controller.close()
    } catch (error) {
      console.error('Error closing progress connection:', error)
    }
    connections.delete(sessionId)
    progressData.delete(sessionId)
  }
}

// Function to clean up connection
export function cleanupProgressConnection(sessionId: string) {
  connections.delete(sessionId)
  progressData.delete(sessionId)
}

export type { ProgressEvent }