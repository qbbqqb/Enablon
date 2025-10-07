'use client'

import { useState } from 'react'
import type { ObservationDraft } from '@/lib/types'
import {
  PROJECTS,
  PROJECT_MAPPINGS,
  ROOM_AREAS,
  OBSERVATION_CATEGORIES,
  CATEGORY_TYPES,
  HRA_CATEGORIES,
  GENERAL_CATEGORIES,
  CONSTRUCTION_PHASES,
  SEVERITY_LEVELS
} from '@/lib/constants/enums'
import type { Project } from '@/lib/constants/enums'

interface ObservationReviewProps {
  observations: ObservationDraft[]
  project: string
  onSave: (updatedObservations: ObservationDraft[]) => void
  onCancel: () => void
}

export default function ObservationReview({ 
  observations, 
  project, 
  onSave, 
  onCancel 
}: ObservationReviewProps) {
  const [editedObservations, setEditedObservations] = useState<ObservationDraft[]>(observations)
  const [expandedCards, setExpandedCards] = useState<Set<number>>(new Set())

  const updateObservation = (index: number, field: keyof ObservationDraft, value: string) => {
    const updated = [...editedObservations]
    updated[index] = { ...updated[index], [field]: value }

    // Handle category type exclusivity
    if (field === 'Category Type') {
      if (value === 'HRA + Significant Exposure') {
        updated[index]['General Category'] = ''
      } else {
        updated[index]['High Risk + Significant Exposure'] = ''
      }
    }

    // Handle project change - update responsible party and person notified
    if (field === 'Project') {
      const projectMapping = PROJECT_MAPPINGS[value as Project]
      if (projectMapping) {
        updated[index]['Responsible Party'] = projectMapping.responsibleParty
        updated[index]['Person Notified'] = projectMapping.personNotified
      }
    }

    setEditedObservations(updated)
  }

  const removeObservation = (index: number) => {
    const updated = editedObservations.filter((_, i) => i !== index)
    setEditedObservations(updated)
  }

  const duplicateObservation = (index: number) => {
    const updated = [...editedObservations]
    const duplicate = { ...editedObservations[index] }
    delete duplicate.__photoToken
    delete duplicate.__photoTokens
    updated.splice(index + 1, 0, duplicate)
    setEditedObservations(updated)
  }

  const toggleExpanded = (index: number) => {
    const newExpanded = new Set(expandedCards)
    if (newExpanded.has(index)) {
      newExpanded.delete(index)
    } else {
      newExpanded.add(index)
    }
    setExpandedCards(newExpanded)
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="bg-white rounded-lg shadow border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Review Observations</h1>
              <p className="text-sm text-gray-600 mt-1">
                Review and edit the {editedObservations.length} generated observations
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
                onClick={() => onSave(editedObservations)}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
              >
                Export {editedObservations.length} Observations
              </button>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {editedObservations.map((obs, index) => (
            <div key={index} className="border border-gray-200 rounded-lg">
              {/* Observation Header */}
              <div 
                className="p-4 bg-gray-50 cursor-pointer flex items-center justify-between"
                onClick={() => toggleExpanded(index)}
              >
                <div className="flex-1">
                  <div className="flex items-center space-x-3">
                    <span className="text-sm font-medium text-gray-500">#{index + 1}</span>
                    <span className="font-medium text-gray-900">{obs['Observation Category']}</span>
                    <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                      {obs['Room/Area']}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                    {obs['Observation Description']}
                  </p>
                </div>
                <div className="flex items-center space-x-2 ml-4">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      duplicateObservation(index)
                    }}
                    className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
                    title="Duplicate"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      removeObservation(index)
                    }}
                    className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                    title="Remove"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                  <svg 
                    className={`w-5 h-5 text-gray-400 transition-transform ${expandedCards.has(index) ? 'rotate-180' : ''}`} 
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              {/* Expanded Edit Form */}
              {expandedCards.has(index) && (
                <div className="p-4 border-t border-gray-200 bg-white">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Project */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Project</label>
                      <select
                        value={obs['Project']}
                        onChange={(e) => updateObservation(index, 'Project', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      >
                        {PROJECTS.map(proj => (
                          <option key={proj} value={proj}>{proj}</option>
                        ))}
                      </select>
                    </div>

                    {/* Room/Area */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Room/Area</label>
                      <select
                        value={obs['Room/Area']}
                        onChange={(e) => updateObservation(index, 'Room/Area', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      >
                        {ROOM_AREAS.map(area => (
                          <option key={area} value={area}>{area}</option>
                        ))}
                      </select>
                    </div>

                    {/* Observation Category */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Observation Category</label>
                      <select
                        value={obs['Observation Category']}
                        onChange={(e) => updateObservation(index, 'Observation Category', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      >
                        {OBSERVATION_CATEGORIES.map(cat => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                    </div>

                    {/* Category Type */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Category Type</label>
                      <select
                        value={obs['Category Type']}
                        onChange={(e) => updateObservation(index, 'Category Type', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      >
                        {CATEGORY_TYPES.map(type => (
                          <option key={type} value={type}>{type}</option>
                        ))}
                      </select>
                    </div>

                    {/* Conditional Category Fields */}
                    {obs['Category Type'] === 'HRA + Significant Exposure' ? (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">High Risk + Significant Exposure</label>
                        <select
                          value={obs['High Risk + Significant Exposure']}
                          onChange={(e) => updateObservation(index, 'High Risk + Significant Exposure', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                        >
                          {HRA_CATEGORIES.map(cat => (
                            <option key={cat} value={cat}>{cat}</option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">General Category</label>
                        <select
                          value={obs['General Category']}
                          onChange={(e) => updateObservation(index, 'General Category', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                        >
                          {GENERAL_CATEGORIES.map(cat => (
                            <option key={cat} value={cat}>{cat}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Phase of Construction */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Phase of Construction</label>
                      <select
                        value={obs['Phase of Construction']}
                        onChange={(e) => updateObservation(index, 'Phase of Construction', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      >
                        {CONSTRUCTION_PHASES.map(phase => (
                          <option key={phase} value={phase}>{phase}</option>
                        ))}
                      </select>
                    </div>

                    {/* Worst Potential Severity */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Worst Potential Severity</label>
                      <select
                        value={obs['Worst Potential Severity']}
                        onChange={(e) => updateObservation(index, 'Worst Potential Severity', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      >
                        {SEVERITY_LEVELS.map(level => (
                          <option key={level} value={level}>{level}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Text Fields */}
                  <div className="grid grid-cols-1 gap-4 mt-4">
                    {/* Observation Description */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Observation Description</label>
                      <textarea
                        value={obs['Observation Description']}
                        onChange={(e) => updateObservation(index, 'Observation Description', e.target.value)}
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-y"
                      />
                    </div>

                    {/* Interim Corrective Actions */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Interim Corrective Actions</label>
                      <textarea
                        value={obs['Interim Corrective Actions']}
                        onChange={(e) => updateObservation(index, 'Interim Corrective Actions', e.target.value)}
                        rows={2}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-y"
                      />
                    </div>

                    {/* Final Corrective Actions */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Final Corrective Actions</label>
                      <textarea
                        value={obs['Final Corrective Actions']}
                        onChange={(e) => updateObservation(index, 'Final Corrective Actions', e.target.value)}
                        rows={2}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-y"
                        placeholder="Start with OPEN - GC to action: or CLOSED: followed by detailed actions..."
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
