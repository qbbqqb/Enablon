import type { Observation } from '../types'

interface BatchConfig {
  maxFilesPerBatch: number
  maxSizePerBatch: number // in bytes
}

interface BatchResult {
  observations: Observation[]
  images: any[]
  failed: any[]
}

interface FileBatch {
  files: File[]
  estimatedSize: number
  batchIndex: number
}

export const BATCH_CONFIG: BatchConfig = {
  maxFilesPerBatch: 6, // Conservative: ensures compressed size stays under 2.5MB
  maxSizePerBatch: 15 * 1024 * 1024, // Conservative: 15MB raw should compress to ~2MB
}

export function createBatches(files: File[]): FileBatch[] {
  const batches: FileBatch[] = []
  let currentBatch: File[] = []
  let currentSize = 0
  let batchIndex = 0

  for (const file of files) {
    const wouldExceedSize = currentSize + file.size > BATCH_CONFIG.maxSizePerBatch
    const wouldExceedCount = currentBatch.length >= BATCH_CONFIG.maxFilesPerBatch

    if ((wouldExceedSize || wouldExceedCount) && currentBatch.length > 0) {
      // Finalize current batch
      batches.push({
        files: [...currentBatch],
        estimatedSize: currentSize,
        batchIndex: batchIndex++
      })

      // Start new batch
      currentBatch = [file]
      currentSize = file.size
    } else {
      // Add to current batch
      currentBatch.push(file)
      currentSize += file.size
    }
  }

  // Add final batch if not empty
  if (currentBatch.length > 0) {
    batches.push({
      files: [...currentBatch],
      estimatedSize: currentSize,
      batchIndex: batchIndex
    })
  }

  return batches
}

export function estimateBatchProcessingTime(batches: FileBatch[]): number {
  // Rough estimates: 30s per batch (upload + AI + processing)
  return batches.length * 30
}

export function combineBatchResults(batchResults: BatchResult[]): {
  observations: Observation[]
  images: any[]
  failed: any[]
} {
  const allImages: any[] = []
  const allFailed: any[] = []

  // Only use observations from the first batch (which contains numbered notes or all observations)
  // All other batches should only contribute their images
  const observations = batchResults.length > 0 ? batchResults[0].observations : []

  batchResults.forEach((result, index) => {
    // Add batch info to failed items for debugging
    const failedWithBatch = result.failed.map(item => ({
      ...item,
      batch: index + 1
    }))

    // Always include images from all batches
    allImages.push(...result.images)
    allFailed.push(...failedWithBatch)
  })

  return {
    observations,
    images: allImages,
    failed: allFailed
  }
}

export function getBatchProgressRange(batchIndex: number, totalBatches: number): { start: number, end: number } {
  const progressPerBatch = 80 / totalBatches // Use 80% of progress for batches (20% for final processing)
  return {
    start: 10 + (batchIndex * progressPerBatch), // Start at 10% (after initial setup)
    end: 10 + ((batchIndex + 1) * progressPerBatch)
  }
}