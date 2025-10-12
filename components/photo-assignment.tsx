'use client'

import { useState, useCallback, useEffect } from 'react'
import Image from 'next/image'

interface Photo {
  id: number
  token: string
  originalName: string
  url: string
}

interface ObservationShell {
  id: number
  notePreview: string
}

interface PhotoAssignmentProps {
  photos: Photo[]
  observations: ObservationShell[]
  initialAssignments?: Record<number, number[]> // AI pre-populated assignments
  onComplete: (assignments: Record<number, number[]>) => void
  onCancel: () => void
}

export default function PhotoAssignment({ photos, observations, initialAssignments = {}, onComplete, onCancel }: PhotoAssignmentProps) {
  const [assignments, setAssignments] = useState<Record<number, number[]>>(initialAssignments)
  const [currentObsIndex, setCurrentObsIndex] = useState(0)
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<number>>(new Set())
  const [showCompletion, setShowCompletion] = useState(false)

  const currentObs = observations[currentObsIndex]
  const isLastObservation = currentObsIndex === observations.length - 1
  const progress = ((currentObsIndex + 1) / observations.length) * 100
  const hasInitialAssignments = Object.keys(initialAssignments).length > 0

  // Get assigned photos for current observation
  const currentAssignedPhotos = assignments[currentObs?.id] || []

  // Get photos that are NOT assigned to other observations
  const getAvailablePhotos = useCallback(() => {
    const otherAssignments = Object.entries(assignments)
      .filter(([obsId]) => parseInt(obsId) !== currentObs?.id)
      .flatMap(([, photoIds]) => photoIds)

    return photos.filter(photo => !otherAssignments.includes(photo.id))
  }, [assignments, currentObs?.id, photos])

  const availablePhotos = getAvailablePhotos()

  // Toggle photo selection
  const togglePhoto = useCallback((photoId: number) => {
    setSelectedPhotoIds(prev => {
      const newSet = new Set(prev)
      if (newSet.has(photoId)) {
        newSet.delete(photoId)
      } else {
        newSet.add(photoId)
      }
      return newSet
    })
  }, [])

  // Save and advance to next observation
  const handleNext = useCallback(() => {
    // Save current selections
    if (selectedPhotoIds.size > 0) {
      setAssignments(prev => ({
        ...prev,
        [currentObs.id]: Array.from(selectedPhotoIds)
      }))
    }

    setSelectedPhotoIds(new Set())

    if (isLastObservation) {
      setShowCompletion(true)
    } else {
      setCurrentObsIndex(prev => prev + 1)
    }
  }, [selectedPhotoIds, currentObs?.id, isLastObservation])

  // Go back to previous observation
  const handleBack = useCallback(() => {
    if (currentObsIndex > 0) {
      // Save current selections
      if (selectedPhotoIds.size > 0) {
        setAssignments(prev => ({
          ...prev,
          [currentObs.id]: Array.from(selectedPhotoIds)
        }))
      }

      setCurrentObsIndex(prev => prev - 1)

      // Load previous observation's selections
      const prevObs = observations[currentObsIndex - 1]
      setSelectedPhotoIds(new Set(assignments[prevObs.id] || []))
    }
  }, [currentObsIndex, selectedPhotoIds, currentObs?.id, assignments, observations])

  // Skip current observation
  const handleSkip = useCallback(() => {
    setSelectedPhotoIds(new Set())
    if (isLastObservation) {
      setShowCompletion(true)
    } else {
      setCurrentObsIndex(prev => prev + 1)
    }
  }, [isLastObservation])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Number keys 1-9 to quick-select photos
      if (e.key >= '1' && e.key <= '9') {
        const photoIndex = parseInt(e.key) - 1
        if (photoIndex < availablePhotos.length) {
          togglePhoto(availablePhotos[photoIndex].id)
        }
      }
      // Enter to continue
      else if (e.key === 'Enter') {
        handleNext()
      }
      // Escape to skip
      else if (e.key === 'Escape') {
        handleSkip()
      }
      // Backspace to go back
      else if (e.key === 'Backspace' && currentObsIndex > 0) {
        e.preventDefault()
        handleBack()
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [availablePhotos, togglePhoto, handleNext, handleSkip, handleBack, currentObsIndex])

  // Load current observation's existing assignments
  useEffect(() => {
    setSelectedPhotoIds(new Set(assignments[currentObs?.id] || []))
  }, [currentObs?.id, assignments])

  // Handle final completion
  const handleComplete = () => {
    // Build final assignments including current selection
    const finalAssignments = { ...assignments }
    if (selectedPhotoIds.size > 0) {
      finalAssignments[currentObs.id] = Array.from(selectedPhotoIds)
    }

    onComplete(finalAssignments)
  }

  // Completion screen
  if (showCompletion) {
    const totalAssigned = Object.values(assignments).flat().length
    const obsWithPhotos = Object.keys(assignments).filter(id => assignments[parseInt(id)].length > 0).length

    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-2xl w-full">
          <div className="text-center">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>

            <h2 className="text-3xl font-bold text-gray-900 mb-4">Assignment Complete!</h2>
            <p className="text-gray-600 mb-8">
              You've assigned {totalAssigned} photo(s) to {obsWithPhotos} observation(s)
            </p>

            <div className="space-y-4">
              <button
                onClick={handleComplete}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 px-6 rounded-lg font-semibold text-lg transition-colors"
              >
                Continue to AI Enrichment →
              </button>
              <button
                onClick={() => {
                  setShowCompletion(false)
                  setCurrentObsIndex(observations.length - 1)
                }}
                className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 py-3 px-6 rounded-lg font-medium transition-colors"
              >
                ← Go Back to Review
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!currentObs) return null

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      {/* Progress Bar */}
      <div className="fixed top-0 left-0 right-0 h-2 bg-gray-200 z-50">
        <div
          className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Header */}
      <div className="sticky top-2 z-40 px-6 pt-6 pb-4">
        <div className="max-w-7xl mx-auto bg-white/95 backdrop-blur-sm rounded-2xl shadow-lg p-6 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <span className="bg-blue-100 text-blue-700 text-sm font-bold px-3 py-1 rounded-full">
                  {currentObsIndex + 1} of {observations.length}
                </span>
                <span className="text-sm text-gray-500">
                  {selectedPhotoIds.size > 0 ? `${selectedPhotoIds.size} photo(s) selected` : 'No photos selected yet'}
                </span>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
                <span className="text-blue-600">#{currentObs.id}</span>
                <span>{currentObs.notePreview}</span>
              </h2>
            </div>
            <button
              onClick={onCancel}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 pb-6">
        {/* Instruction */}
        <div className="mb-6 text-center">
          <p className="text-gray-600 text-lg">
            {hasInitialAssignments
              ? '🤖 AI has assigned photos - Review and adjust if needed'
              : 'Click photos to assign them to this observation'}
          </p>
          <p className="text-sm text-gray-500 mt-2">
            💡 Tip: Use number keys <kbd className="px-2 py-1 bg-gray-100 rounded text-xs">1-9</kbd> for quick selection,
            <kbd className="px-2 py-1 bg-gray-100 rounded text-xs mx-1">Enter</kbd> to continue
          </p>
        </div>

        {/* Photo Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6 mb-8">
          {availablePhotos.map((photo, index) => {
            const isSelected = selectedPhotoIds.has(photo.id)
            const keyboardShortcut = index < 9 ? index + 1 : null

            return (
              <div
                key={photo.id}
                onClick={() => togglePhoto(photo.id)}
                className={`group relative cursor-pointer transition-all duration-300 transform hover:scale-105 ${
                  isSelected ? 'scale-105' : ''
                }`}
              >
                {/* Keyboard Shortcut Badge */}
                {keyboardShortcut && (
                  <div className="absolute -top-2 -left-2 z-10 w-7 h-7 bg-gray-900 text-white rounded-full flex items-center justify-center text-xs font-bold shadow-lg">
                    {keyboardShortcut}
                  </div>
                )}

                {/* Photo Card */}
                <div className={`relative aspect-square rounded-2xl overflow-hidden transition-all duration-300 ${
                  isSelected
                    ? 'ring-4 ring-blue-500 ring-offset-4 shadow-2xl'
                    : 'ring-2 ring-gray-200 hover:ring-gray-300 shadow-md hover:shadow-xl'
                }`}>
                  <Image
                    src={photo.url}
                    alt={`Photo ${photo.id}`}
                    fill
                    className="object-cover"
                    sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
                  />

                  {/* Selection Overlay */}
                  {isSelected && (
                    <div className="absolute inset-0 bg-blue-500/20 flex items-center justify-center">
                      <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center shadow-xl">
                        <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    </div>
                  )}

                  {/* Hover Overlay */}
                  {!isSelected && (
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                      <div className="absolute bottom-3 left-3 right-3">
                        <p className="text-white text-xs font-medium truncate">
                          {photo.originalName}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Photo Number */}
                  <div className="absolute top-3 right-3 bg-black/70 text-white text-xs font-bold px-2 py-1 rounded-lg">
                    #{photo.id}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Bottom Action Bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t border-gray-200 shadow-2xl">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between gap-4">
            {/* Back Button */}
            <button
              onClick={handleBack}
              disabled={currentObsIndex === 0}
              className="flex items-center gap-2 px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>

            {/* Center Info */}
            <div className="flex items-center gap-4">
              {selectedPhotoIds.size > 0 ? (
                <div className="text-center">
                  <p className="text-sm text-gray-600">
                    {selectedPhotoIds.size} photo(s) selected for observation #{currentObs.id}
                  </p>
                </div>
              ) : currentAssignedPhotos.length > 0 ? (
                <div className="text-center">
                  <p className="text-sm text-green-600 font-medium">
                    ✓ {currentAssignedPhotos.length} photo(s) assigned by AI
                  </p>
                </div>
              ) : (
                <button
                  onClick={handleSkip}
                  className="px-6 py-3 text-gray-600 hover:text-gray-800 font-medium transition-colors"
                >
                  Skip This Observation
                </button>
              )}
            </div>

            {/* Next/Finish Button */}
            <button
              onClick={handleNext}
              className="flex items-center gap-2 px-8 py-3 rounded-xl font-semibold transition-all transform hover:scale-105 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white shadow-lg"
            >
              {isLastObservation ? 'Finish' : 'Next'}
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
