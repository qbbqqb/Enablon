'use client'

import { useState } from 'react'
import type { Observation } from '@/lib/types'

interface ProjectResult {
  project: string
  observations: Observation[]
  images: any[]
  notes: string
  processedCount: number
}

interface MultiProjectReviewProps {
  projectResults: ProjectResult[]
  onExportAll: (projectResults: ProjectResult[]) => void
  onExportSelected: (selectedResults: ProjectResult[]) => void
  onCancel: () => void
}

export default function MultiProjectReview({ 
  projectResults, 
  onExportAll,
  onExportSelected,
  onCancel 
}: MultiProjectReviewProps) {
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(
    new Set(projectResults.map(r => r.project))
  )
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())

  const toggleProjectSelection = (project: string) => {
    const newSelected = new Set(selectedProjects)
    if (newSelected.has(project)) {
      newSelected.delete(project)
    } else {
      newSelected.add(project)
    }
    setSelectedProjects(newSelected)
  }

  const toggleProjectExpanded = (project: string) => {
    const newExpanded = new Set(expandedProjects)
    if (newExpanded.has(project)) {
      newExpanded.delete(project)
    } else {
      newExpanded.add(project)
    }
    setExpandedProjects(newExpanded)
  }

  const handleExportSelected = () => {
    const selectedResults = projectResults.filter(r => selectedProjects.has(r.project))
    onExportSelected(selectedResults)
  }

  const totalObservations = projectResults.reduce((sum, r) => sum + r.observations.length, 0)
  const selectedObservations = projectResults
    .filter(r => selectedProjects.has(r.project))
    .reduce((sum, r) => sum + r.observations.length, 0)

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="bg-white rounded-lg shadow border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Multi-Project Review</h1>
              <p className="text-sm text-gray-600 mt-1">
                {projectResults.length} projects detected with {totalObservations} total observations
              </p>
            </div>
            <div className="flex space-x-3">
              <button
                onClick={onCancel}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => onExportAll(projectResults)}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors font-semibold"
              >
                Export All ({totalObservations} observations)
              </button>
              {selectedProjects.size > 0 && selectedProjects.size < projectResults.length && (
                <button
                  onClick={handleExportSelected}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
                >
                  Export Selected ({selectedObservations} observations)
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {projectResults.map((result) => (
            <div key={result.project} className="border border-gray-200 rounded-lg overflow-hidden">
              {/* Project Header */}
              <div className="bg-gray-50 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedProjects.has(result.project)}
                        onChange={() => toggleProjectSelection(result.project)}
                        className="w-4 h-4 text-blue-600 focus:ring-blue-500 rounded"
                      />
                      <span className="text-lg font-semibold text-gray-900">
                        Project {result.project}
                      </span>
                    </label>
                    <span className="px-2 py-1 bg-blue-100 text-blue-800 text-sm font-medium rounded-full">
                      {result.observations.length} observations
                    </span>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => toggleProjectExpanded(result.project)}
                      className="px-3 py-1 text-sm text-gray-600 hover:text-gray-900 transition-colors"
                    >
                      {expandedProjects.has(result.project) ? 'Hide Details' : 'Show Details'}
                    </button>
                    <svg 
                      className={`w-5 h-5 text-gray-400 transition-transform ${
                        expandedProjects.has(result.project) ? 'rotate-180' : ''
                      }`} 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
                
                {/* Project Notes Preview */}
                <div className="mt-2 text-sm text-gray-600 bg-white rounded p-3 border">
                  <p className="line-clamp-2">{result.notes}</p>
                </div>
              </div>

              {/* Expanded Project Details */}
              {expandedProjects.has(result.project) && (
                <div className="p-4 border-t border-gray-200 bg-white">
                  <h4 className="font-medium text-gray-900 mb-3">Generated Observations:</h4>
                  <div className="space-y-3">
                    {result.observations.map((obs, index) => (
                      <div key={index} className="bg-gray-50 rounded-lg p-3 border">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center space-x-2 mb-2">
                              <span className="text-xs font-medium text-gray-500">#{index + 1}</span>
                              <span className="text-sm font-medium text-blue-700">{obs['Observation Category']}</span>
                              <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded">
                                {obs['Room/Area']}
                              </span>
                            </div>
                            <p className="text-sm text-gray-700">{obs['Observation Description']}</p>
                            {obs['Final Corrective Actions'] && (
                              <p className="text-xs text-gray-600 mt-1">
                                <strong>Actions:</strong> {obs['Final Corrective Actions']}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Selection Summary */}
        {selectedProjects.size > 0 && (
          <div className="border-t border-gray-200 p-4 bg-blue-50">
            <div className="flex items-center justify-between">
              <div className="text-sm text-blue-700">
                <span className="font-medium">
                  {selectedProjects.size} projects selected
                </span>
                {selectedProjects.size < projectResults.length && (
                  <span className="ml-2">
                    ({selectedObservations} of {totalObservations} observations)
                  </span>
                )}
              </div>
              <div className="flex items-center space-x-2 text-xs text-blue-600">
                <span>Each project will create a separate ZIP file</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}