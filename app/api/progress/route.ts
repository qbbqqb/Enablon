import { NextRequest } from 'next/server'
import {
  registerProgressConnection,
  getExistingProgress,
  cleanupProgressConnection
} from '@/lib/progress/manager'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const sessionId = url.searchParams.get('sessionId')
  
  if (!sessionId) {
    return new Response('Missing sessionId', { status: 400 })
  }

  const stream = new ReadableStream({
    start(controller) {
      // Register connection
      registerProgressConnection(sessionId, controller)

      // Send initial message
      const initialMessage = `data: ${JSON.stringify({
        id: sessionId,
        progress: 0,
        label: 'Connected to progress stream',
        step: 'connected'
      })}\n\n`

      controller.enqueue(new TextEncoder().encode(initialMessage))

      // Send existing progress if available
      const existingProgress = getExistingProgress(sessionId)
      if (existingProgress) {
        const progressMessage = `data: ${JSON.stringify(existingProgress)}\n\n`
        controller.enqueue(new TextEncoder().encode(progressMessage))
      }
    },
    cancel() {
      // Clean up connection
      cleanupProgressConnection(sessionId)
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

