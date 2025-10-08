'use client'

import { useState, useEffect } from 'react'
import Dropzone from '@/components/dropzone'
import ProgressBar from '@/components/progress-bar'
import ObservationReview from '@/components/observation-review'
import { detectProjectFromNotes, detectAllProjectsFromNotes } from '@/lib/utils/projectDetection'
import { createBatches, combineBatchResults, estimateBatchProcessingTime, getBatchProgressRange } from '@/lib/batch/processor'
import { compressFileBatch } from '@/lib/client/compress'
import type { CompressedFile } from '@/lib/client/compress'
import type { Project } from '@/lib/constants/enums'
import { PROJECTS } from '@/lib/constants/enums'
import type { ObservationDraft } from '@/lib/types'
import {ModeToggle} from "@/components/ModeToggle";

export default function Home() {
  const [files, setFiles] = useState<File[]>([])
  const [notes, setNotes] = useState('')
  const [detectedProject, setDetectedProject] = useState<Project | null>(null)
  const [allDetectedProjects, setAllDetectedProjects] = useState<Project[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState('')
  const [progressDetails, setProgressDetails] = useState<{
    processed?: number
    total?: number
    batchIndex?: number
    totalBatches?: number
  }>({})
  const [eventSource, setEventSource] = useState<EventSource | null>(null)
  const [showReview, setShowReview] = useState(false)
  const [observations, setObservations] = useState<ObservationDraft[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)

  // Cleanup EventSource on component unmount
  useEffect(() => {
    return () => {
      eventSource?.close()
    }
  }, [eventSource])

  // Auto-detect projects from notes
  useEffect(() => {
    const project = detectProjectFromNotes(notes)
    const allProjects = detectAllProjectsFromNotes(notes)
    
    setDetectedProject(project)
    setAllDetectedProjects(allProjects)
  }, [notes])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (files.length === 0) {
      alert('Please select at least one photo')
      return
    }

    // Use detected project or default to first available project for processing
    const projectToUse = detectedProject || PROJECTS[0]
    
    // Generate unique session ID
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    setSessionId(sessionId)
    
    setIsProcessing(true)
    setProgress(0)
    setProgressLabel('Connecting to progress stream...')
    setProgressDetails({})
    
    // Connect to SSE for progress updates
    const es = new EventSource(`/api/progress?sessionId=${sessionId}`)
    setEventSource(es)
    
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        setProgress(data.progress)
        setProgressLabel(data.label)
        setProgressDetails(data.details || {})
      } catch (error) {
        console.error('Error parsing progress update:', error)
      }
    }
    
    es.onerror = (error) => {
      console.error('EventSource error:', error)
    }
    
    try {
      // Check for overly large individual files first
      const oversizedFiles = files.filter(f => f.size > 10 * 1024 * 1024) // 10MB per file
      if (oversizedFiles.length > 0) {
        alert(`Some files are too large:\n${oversizedFiles.map(f => `${f.name}: ${(f.size/1024/1024).toFixed(1)}MB`).join('\n')}\n\nPlease use images smaller than 10MB each.`)
        setIsProcessing(false)
        return
      }

      // Use simple endpoint for all requests - no complex batching logic
      console.log(`Processing ${files.length} files with simple approach`)
      setProgressLabel('Uploading files to server...')

      const formData = new FormData()
      formData.append('project', projectToUse)
      formData.append('notes', notes)
      formData.append('sessionId', sessionId)
      files.forEach(file => formData.append('files', file))

      const response = await fetch('/api/simple', {
        method: 'POST',
        body: formData,
        headers: {
          'X-Mode': 'review',
          'X-Session-Id': sessionId
        }
      })

      if (!response.ok) {
        let errorMessage = `Server error ${response.status}`

        try {
          const errorData = await response.clone().json()
          if (typeof errorData?.message === 'string' && errorData.message.trim().length > 0) {
            errorMessage = errorData.message
          } else if (typeof errorData?.error === 'string' && errorData.error.trim().length > 0) {
            errorMessage = errorData.error
          }
        } catch (jsonError) {
          try {
            const text = await response.text()
            if (text.trim().length > 0) {
              errorMessage = text
            }
          } catch (_) {
            // Ignore secondary errors while reading response body
          }
        }

        throw new Error(errorMessage)
      }

      const result = await response.json()
      console.log(`Simple request completed: ${result.observations?.length || 0} observations`)

      if (typeof result.sessionId === 'string' && result.sessionId.trim().length > 0) {
        setSessionId(result.sessionId)
      }

      setObservations(result.observations || [])
      setProgress(100)
      setProgressLabel(`Analysis complete - ${result.observations?.length || 0} observations ready for review`)
      setIsProcessing(false)
      setShowReview(true)

      // Close SSE connection
      eventSource?.close()
      setEventSource(null)

      return // Skip all complex batch processing below

      // Fallback to batch processing for non-numbered notes
      const batches = createBatches(files)
      const totalFiles = files.reduce((sum, file) => sum + file.size, 0)
      const estimatedTime = estimateBatchProcessingTime(batches)

      console.log(`Batch Processing: ${files.length} files → ${batches.length} batches (estimated ${Math.round(estimatedTime/60)}min)`)

      // Auto-process batches without confirmation dialog

      // Process all batches sequentially
      const batchResults = []

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i]
        const progressRange = getBatchProgressRange(i, batches.length)

        // Update progress for batch start
        if (eventSource) {
          // SSE updates will be handled by the API
        }

        console.log(`Processing batch ${i + 1}/${batches.length}: ${batch.files.length} files, ${(batch.estimatedSize / 1024 / 1024).toFixed(1)}MB`)

        // Client-side compression before sending
        setProgressLabel(`Compressing batch ${i + 1}/${batches.length}...`)
        setProgress(progressRange.start)

        let compressedFiles: CompressedFile[]
        try {
          compressedFiles = await compressFileBatch(batch.files, 2.5) // Target 2.5MB per batch
        } catch (error) {
          console.error(`Failed to compress batch ${i + 1}:`, error)
          throw new Error(`Batch ${i + 1} compression failed: ${(error as Error)?.message || 'Unknown error'}`)
        }

        const totalCompressedSize = compressedFiles.reduce((sum: number, cf) => sum + cf.compressedSize, 0)
        console.log(`Batch ${i + 1} compressed: ${(totalCompressedSize / 1024 / 1024).toFixed(2)}MB`)

        if (totalCompressedSize > 2.5 * 1024 * 1024) { // 2.5MB safety limit
          console.error(`Batch ${i + 1} too large:`, compressedFiles.map(cf => `${cf.file.name}: ${(cf.compressedSize/1024).toFixed(0)}KB`))
          throw new Error(`Batch ${i + 1} still too large after compression: ${(totalCompressedSize / 1024 / 1024).toFixed(1)}MB. Try fewer photos or smaller images.`)
        }

        const formData = new FormData()
        formData.append('project', projectToUse)
        // Only send notes to the first batch to prevent duplicate observations
        if (i === 0) {
          formData.append('notes', notes)
        } else {
          formData.append('notes', '') // Empty notes for subsequent batches
        }
        formData.append('sessionId', sessionId)
        // Remove batch-related parameters since /api/generate handles batching internally
        compressedFiles.forEach(cf => formData.append('files', cf.file))

        setProgressLabel(`Uploading batch ${i + 1}/${batches.length}...`)

        const response = await fetch('/api/generate', {
          method: 'POST',
          body: formData,
          headers: {
            'X-Mode': 'review' // Request review mode instead of ZIP
          }
        })

        if (!response.ok) {
          throw new Error(`Batch ${i + 1} failed: Server error ${response.status}`)
        }

        const batchResult = await response.json()
        batchResults.push(batchResult)

        console.log(`Batch ${i + 1} completed: ${batchResult.observations?.length || 0} observations`)
      }

      // Combine all batch results
      console.log('Combining batch results...')
      if (sessionId) {
        // Manual progress update for combining phase
        const es = new EventSource(`/api/progress?sessionId=${sessionId}`)
        es.addEventListener('message', () => {}) // Keep alive
        setTimeout(() => {
          es.close()
        }, 2000)
      }

      const combinedResults = combineBatchResults(batchResults)

      console.log(`Batch processing complete: ${combinedResults.observations.length} total observations, ${combinedResults.failed.length} failed`)

      setObservations(combinedResults.observations)

      // Close SSE connection
      eventSource?.close()
      setEventSource(null)

      setIsProcessing(false)
      setShowReview(true)
      
    } catch (error) {
      console.error('Processing failed:', error)
      alert(`Processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      setIsProcessing(false)
      setProgress(0)
      setProgressLabel('')
      setProgressDetails({})
      setSessionId(null)
      
      // Close SSE connection on error
      if (eventSource) {
        eventSource.close()
        setEventSource(null)
      }
    }
  }

  const handleExportObservations = async (reviewedObservations: ObservationDraft[]) => {
    setIsExporting(true)

    try {
      // Use "mixed" as project name when multiple projects are detected
      const projectForFilename = allDetectedProjects.length > 1 ? 'mixed' : (detectedProject || 'unknown')

      if (!sessionId) {
        throw new Error('Session expired. Please run the analysis again before exporting.')
      }

      console.log('Export request:', {
        observations: reviewedObservations.length,
        project: projectForFilename,
        detectedProject,
        allDetectedProjects,
        sessionId
      })

      const response = await fetch('/api/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          observations: reviewedObservations,
          project: projectForFilename,
          sessionId
        })
      })
      
      if (!response.ok) {
        const errorText = await response.text()
        console.error('Export API error:', response.status, errorText)
        throw new Error(`Export failed: ${response.status} - ${errorText}`)
      }
      
      // Handle ZIP download
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `enablon-observations-${projectForFilename.toLowerCase()}-reviewed-${new Date().toISOString().split('T')[0]}.zip`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      
      // Reset to initial state
      setFiles([])
      setNotes('')
      setObservations([])
      setShowReview(false)
      setDetectedProject(null)
      setAllDetectedProjects([])
      setSessionId(null)
      
    } catch (error) {
      console.error('Export failed:', error)
      alert(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsExporting(false)
    }
  }

  const handleCancelReview = () => {
    setShowReview(false)
    setObservations([])
    setProgress(0)
    setProgressLabel('')
    setProgressDetails({})
    setSessionId(null)
  }


  // Show single-project review interface if observations are ready
  if (showReview) {
    return (
      <main className="min-h-screen bg-background">
        <ObservationReview 
          observations={observations}
          project={detectedProject || ''}
          onSave={handleExportObservations}
          onCancel={handleCancelReview}
        />
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground">
                  Safety Observation Tool
                </h1>
                <p className="text-sm text-muted-foreground">
                  Convert photos and notes into Enablon-compliant observations
                </p>
              </div>
            </div>
            <a
              href="/help"
              className="text-primary hover:text-primary/80 font-medium text-sm flex items-center space-x-1"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>Help</span>
            </a>
              <ModeToggle />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-card rounded-lg shadow border border-border">
          <div className="p-6">
          
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Upload Photos */}
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-foreground">Upload Photos</h2>
              <Dropzone 
                onFilesSelected={setFiles} 
                disabled={isProcessing}
              />
            </div>
            
            {/* Site Walk Notes */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground">Site Walk Notes</h2>
              </div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={isProcessing}
                placeholder="Describe your site walk observations. Include project code (e.g., GVX04), locations (e.g., COLO5 loading bay), safety issues, positive practices, personnel involved, and actions taken..."
                rows={6}
                className="w-full px-4 py-3 border border-input bg-background rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:bg-muted resize-y"
              />
              
              {!detectedProject && notes.length > 10 && (
                <div className="bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-900 rounded-lg p-3">
                  <p className="text-yellow-800 dark:text-yellow-300 text-sm">
                    <strong>Missing project code:</strong> Please include GVX04, GVX03, or GVX05 in your notes to auto-detect the project.
                  </p>
                </div>
              )}
              
              
              <div className="bg-muted p-3 rounded border-l-4 border-border">
                <p className="font-medium text-foreground mb-1 text-sm">Example:</p>
                <p className="text-muted-foreground text-sm italic">
                  "GVX04 COLO2 - Jones operatives working on walkway without barriers and spotter. Work paused immediately, barriers installed, spotter assigned before resuming. GVX04 COLO3 - Barrier moved from electrical panel exposing live equipment. Collen EHS reminded subcontractors to keep barriers in place around temp electrical equipment. GVX05 Positive - AED device properly mounted and accessible in main building."
                </p>
              </div>
            </div>
            
            {/* Progress Section */}
            {isProcessing && (
              <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-lg p-6">
                <div className="flex items-center space-x-3 mb-4">
                  <div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full"></div>
                  <span className="text-lg font-semibold text-blue-900 dark:text-blue-300">Processing Observations</span>
                </div>
                <ProgressBar 
                  progress={progress}
                  label={progressLabel}
                  className="mb-4"
                />
                
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div className="flex items-center space-x-2">
                    <div className={`w-2 h-2 rounded-full ${progress > 15 ? 'bg-green-500 dark:bg-green-400' : 'bg-gray-300 dark:bg-gray-600'}`}></div>
                    <span className="text-muted-foreground">Images</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className={`w-2 h-2 rounded-full ${progress > 35 && progress < 85 ? 'bg-primary animate-pulse' : progress >= 85 ? 'bg-green-500 dark:bg-green-400' : 'bg-gray-300 dark:bg-gray-600'}`}></div>
                    <span className="text-muted-foreground">Analysis</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className={`w-2 h-2 rounded-full ${progress > 85 && progress < 100 ? 'bg-primary animate-pulse' : progress === 100 ? 'bg-green-500 dark:bg-green-400' : 'bg-gray-300 dark:bg-gray-600'}`}></div>
                    <span className="text-muted-foreground">Export</span>
                  </div>
                </div>
              </div>
            )}
            
            {/* Submit Button */}
            <div className="pt-4">
              <button
                type="submit"
                disabled={isProcessing || files.length === 0 || allDetectedProjects.length === 0}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-3 px-6 rounded-lg font-semibold text-lg disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed transition-colors"
              >
                {isProcessing ? (
                  <div className="flex items-center justify-center space-x-3">
                    <div className="animate-spin w-5 h-5 border-2 border-primary-foreground border-t-transparent rounded-full"></div>
                    <span>Processing...</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center space-x-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span>Analyze Photos</span>
                  </div>
                )}
              </button>
              
              {(files.length === 0 || allDetectedProjects.length === 0) && (
                <p className="text-center text-muted-foreground text-sm mt-2">
                  {files.length === 0 
                    ? "Please upload photos and include project code in notes" 
                    : allDetectedProjects.length === 0
                    ? "Please include project code (GVX04, GVX03, or GVX05) in your notes"
                    : ""
                  }
                </p>
              )}
            </div>
          </form>
          </div>
        </div>
        
        {/* Footer Info */}
        <div className="mt-6 text-center text-muted-foreground text-sm">
          <p>Secure processing • Enablon-compliant output</p>
        </div>
      </div>
    </main>
  )
}
