import { NextRequest } from 'next/server'

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

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const sessionId = url.searchParams.get('sessionId')
  
  if (!sessionId) {
    return new Response('Missing sessionId', { status: 400 })
  }

  const stream = new ReadableStream({
    start(controller) {
      // Store connection
      connections.set(sessionId, controller)
      
      // Send initial message
      const initialMessage = `data: ${JSON.stringify({
        id: sessionId,
        progress: 0,
        label: 'Connected to progress stream',
        step: 'connected'
      })}\n\n`
      
      controller.enqueue(new TextEncoder().encode(initialMessage))
      
      // Send existing progress if available
      const existingProgress = progressData.get(sessionId)
      if (existingProgress) {
        const progressMessage = `data: ${JSON.stringify(existingProgress)}\n\n`
        controller.enqueue(new TextEncoder().encode(progressMessage))
      }
    },
    cancel() {
      // Clean up connection
      connections.delete(sessionId)
      progressData.delete(sessionId)
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Cache-Control'
    }
  })
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