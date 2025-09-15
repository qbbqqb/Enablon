'use client'

import { useCallback, useState, useEffect } from 'react'
import { CONSTANTS } from '@/lib/constants/enums'

interface FileWithPreview extends File {
  preview?: string
}

interface DropzoneProps {
  onFilesSelected: (files: File[]) => void
  maxFiles?: number
  disabled?: boolean
}

export default function Dropzone({ 
  onFilesSelected, 
  maxFiles = CONSTANTS.MAX_FILES,
  disabled = false 
}: DropzoneProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [files, setFiles] = useState<FileWithPreview[]>([])

  // Generate preview URLs for image files
  const generatePreviews = useCallback((fileList: File[]): FileWithPreview[] => {
    return fileList.map(file => {
      const fileWithPreview = file as FileWithPreview
      if (file.type.startsWith('image/') && !file.name.toLowerCase().endsWith('.heic')) {
        fileWithPreview.preview = URL.createObjectURL(file)
      }
      return fileWithPreview
    })
  }, [])

  // Clean up preview URLs when component unmounts or files change
  useEffect(() => {
    return () => {
      files.forEach(file => {
        if (file.preview) {
          URL.revokeObjectURL(file.preview)
        }
      })
    }
  }, [files])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (!disabled) {
      setIsDragOver(true)
    }
  }, [disabled])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    
    if (disabled) return

    const droppedFiles = Array.from(e.dataTransfer.files)
    const imageFiles = droppedFiles.filter(file =>
      file.type.startsWith('image/') ||
      file.name.toLowerCase().endsWith('.heic')
    )

    // Filter out duplicates based on name and size
    const existingFileKeys = new Set(files.map(f => `${f.name}-${f.size}`))
    const newImageFiles = imageFiles.filter(file =>
      !existingFileKeys.has(`${file.name}-${file.size}`)
    )

    if (newImageFiles.length === 0) {
      alert('All files are already added!')
      return
    }

    if (files.length + newImageFiles.length > maxFiles) {
      alert(`Too many files! Maximum ${maxFiles} files allowed. You have ${files.length} and trying to add ${newImageFiles.length}.`)
      return
    }
    
    const totalSize = newImageFiles.reduce((sum, file) => sum + file.size, 0) + files.reduce((sum, file) => sum + file.size, 0)
    const vercelSafeLimit = 150 * 1024 * 1024 // 150MB raw limit (will be processed in batches)

    if (totalSize > vercelSafeLimit) {
      alert(`Total file size too large! Maximum ${vercelSafeLimit / 1024 / 1024}MB raw size allowed. Current: ${(totalSize / 1024 / 1024).toFixed(1)}MB. Large uploads will be processed in batches automatically.`)
      return
    }

    if (totalSize > CONSTANTS.MAX_UPLOAD_SIZE) {
      alert(`Total file size too large! Maximum ${CONSTANTS.MAX_UPLOAD_SIZE / 1024 / 1024}MB allowed.`)
      return
    }

    const filesWithPreviews = generatePreviews(newImageFiles)
    const newFiles = [...files, ...filesWithPreviews]
    setFiles(newFiles)
    onFilesSelected(newFiles)
  }, [disabled, maxFiles, onFilesSelected, generatePreviews, files])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return
    
    const selectedFiles = Array.from(e.target.files || [])
    const imageFiles = selectedFiles.filter(file =>
      file.type.startsWith('image/') ||
      file.name.toLowerCase().endsWith('.heic')
    )

    // Filter out duplicates based on name and size
    const existingFileKeys = new Set(files.map(f => `${f.name}-${f.size}`))
    const newImageFiles = imageFiles.filter(file =>
      !existingFileKeys.has(`${file.name}-${file.size}`)
    )

    if (newImageFiles.length === 0) {
      alert('All files are already added!')
      return
    }

    if (files.length + newImageFiles.length > maxFiles) {
      alert(`Too many files! Maximum ${maxFiles} files allowed. You have ${files.length} and trying to add ${newImageFiles.length}.`)
      return
    }
    
    const totalSize = newImageFiles.reduce((sum, file) => sum + file.size, 0) + files.reduce((sum, file) => sum + file.size, 0)
    const vercelSafeLimit = 150 * 1024 * 1024 // 150MB raw limit (will be processed in batches)

    if (totalSize > vercelSafeLimit) {
      alert(`Total file size too large! Maximum ${vercelSafeLimit / 1024 / 1024}MB raw size allowed. Current: ${(totalSize / 1024 / 1024).toFixed(1)}MB. Large uploads will be processed in batches automatically.`)
      return
    }

    if (totalSize > CONSTANTS.MAX_UPLOAD_SIZE) {
      alert(`Total file size too large! Maximum ${CONSTANTS.MAX_UPLOAD_SIZE / 1024 / 1024}MB allowed.`)
      return
    }

    const filesWithPreviews = generatePreviews(newImageFiles)
    const newFiles = [...files, ...filesWithPreviews]
    setFiles(newFiles)
    onFilesSelected(newFiles)
  }, [disabled, maxFiles, onFilesSelected, generatePreviews, files])

  const clearFiles = () => {
    setFiles([])
    onFilesSelected([])
  }

  const removeFile = (index: number) => {
    // Clean up preview URL for the removed file
    const fileToRemove = files[index]
    if (fileToRemove?.preview) {
      URL.revokeObjectURL(fileToRemove.preview)
    }
    
    const updatedFiles = files.filter((_, i) => i !== index)
    setFiles(updatedFiles)
    onFilesSelected(updatedFiles)
  }

  return (
    <div className="w-full">
      <div
        className={`
          relative border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200
          ${isDragOver && !disabled ? 'border-blue-500 bg-blue-50 scale-[1.01]' : 'border-gray-300'}
          ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-50' : 'hover:border-blue-400 hover:bg-blue-50/50 cursor-pointer'}
          ${files.length > 0 ? 'border-green-400 bg-green-50/50' : ''}
        `}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !disabled && document.getElementById('file-input')?.click()}
      >
        <input
          id="file-input"
          type="file"
          multiple
          accept="image/*,.heic"
          onChange={handleFileInput}
          className="hidden"
          disabled={disabled}
        />
        
        <div className="space-y-4">
          {files.length === 0 ? (
            <>
              <div className="flex justify-center">
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-semibold text-gray-900">
                  Upload Safety Photos
                </h3>
                <p className="text-gray-600">
                  Drag and drop your photos here, or click to browse
                </p>
              </div>
              <div className="space-y-1 text-sm text-gray-500">
                <div className="flex items-center justify-center space-x-4">
                  <div className="flex items-center space-x-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span>JPG, PNG, HEIC</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    <span>Max {maxFiles} files</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                    </svg>
                    <span>Max {CONSTANTS.MAX_UPLOAD_SIZE / 1024 / 1024}MB</span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex justify-center">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-semibold text-green-800">
                  {files.length} photo{files.length !== 1 ? 's' : ''} ready
                </h3>
                <p className="text-green-700">
                  Total size: {(files.reduce((sum, f) => sum + f.size, 0) / 1024 / 1024).toFixed(1)}MB
                </p>
              </div>
            </>
          )}
        </div>
      </div>
      
      {files.length > 0 && (
        <div className="mt-6">
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
              <h4 className="text-sm font-semibold text-gray-900 flex items-center space-x-2">
                <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span>Selected Files ({files.length})</span>
              </h4>
              <button
                onClick={clearFiles}
                disabled={disabled}
                className="text-sm text-red-600 hover:text-red-800 disabled:text-gray-400 flex items-center space-x-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                <span>Clear all</span>
              </button>
            </div>
            <div className="max-h-60 overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-2">
                {files.map((file, index) => (
                  <div key={index} className="border border-gray-200 rounded-lg p-3 hover:bg-gray-50 transition-colors">
                    <div className="flex items-center space-x-3">
                      {/* Photo Preview or Icon */}
                      <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-gray-100">
                        {file.preview ? (
                          <img 
                            src={file.preview} 
                            alt={file.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            {file.name.toLowerCase().endsWith('.heic') ? (
                              <svg className="w-6 h-6 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            ) : (
                              <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            )}
                          </div>
                        )}
                      </div>
                      
                      {/* File Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                        <div className="flex items-center space-x-2 mt-1">
                          <span className="text-xs text-gray-500">
                            {file.name.toLowerCase().endsWith('.heic') ? 'HEIC' : file.type?.split('/')[1]?.toUpperCase() || 'IMG'}
                          </span>
                          <span className="text-xs text-gray-400">•</span>
                          <span className="text-xs text-gray-500">
                            {(file.size / 1024 / 1024).toFixed(1)}MB
                          </span>
                        </div>
                      </div>

                      {/* Remove Button */}
                      <button
                        onClick={() => removeFile(index)}
                        disabled={disabled}
                        className="w-6 h-6 rounded-full bg-red-100 hover:bg-red-200 text-red-600 hover:text-red-700 flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                        title="Remove photo"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="px-4 py-2 bg-green-50 border-t border-gray-200">
              <div className="flex items-center justify-between text-sm">
                <span className="text-green-700 font-medium">Ready for processing</span>
                <span className="text-green-600">
                  Total: {(files.reduce((sum, f) => sum + f.size, 0) / 1024 / 1024).toFixed(1)}MB
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}