import sharp from 'sharp'
import { CONSTANTS } from '../constants/enums'
import type { ProcessedImage, FailedItem } from '../types'
import { mapWithConcurrency } from '../utils/concurrency'

const NORMALIZE_CONCURRENCY = 4

type NormalizationOutcome =
  | { success: true; image: ProcessedImage }
  | { success: false; failure: FailedItem }

export async function normalizeImages(files: any[]): Promise<{
  images: ProcessedImage[]
  failed: FailedItem[]
}> {
  const limit = Math.min(NORMALIZE_CONCURRENCY, Math.max(files.length, 1))

  const processed = await mapWithConcurrency(files, limit, async (file, index): Promise<NormalizationOutcome> => {
    try {
      let inputBuffer: Buffer
      if (file.arrayBuffer && typeof file.arrayBuffer === 'function') {
        const arrayBuffer = await file.arrayBuffer()
        inputBuffer = Buffer.from(arrayBuffer)
      } else if (file.stream && typeof file.stream === 'function') {
        const chunks: Uint8Array[] = []
        const reader = file.stream().getReader()

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
        }

        const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
        const combined = new Uint8Array(totalLength)
        let offset = 0
        for (const chunk of chunks) {
          combined.set(chunk, offset)
          offset += chunk.length
        }
        inputBuffer = Buffer.from(combined)
      } else {
        throw new Error('Unsupported file format - no arrayBuffer or stream method available')
      }

      const processedBuffer = await sharp(inputBuffer)
        .jpeg({ quality: Math.round(CONSTANTS.IMAGE_QUALITY * 100) })
        .resize({
          width: CONSTANTS.IMAGE_MAX_DIMENSION,
          height: CONSTANTS.IMAGE_MAX_DIMENSION,
          fit: 'inside',
          withoutEnlargement: true
        })
        .toBuffer()

      if (processedBuffer.length > CONSTANTS.MAX_FILE_SIZE) {
        return {
          success: false,
          failure: {
            originalFilename: file.name || `file-${index}`,
            reason: `File still too large after compression: ${(processedBuffer.length / 1024 / 1024).toFixed(1)}MB > 10MB`,
            step: 'processing'
          }
        }
      }

      return {
        success: true,
        image: {
          originalIndex: index,
          originalName: file.name || `image-${index}.jpg`,
          buffer: processedBuffer,
          mimeType: 'image/jpeg'
        }
      }
    } catch (error) {
      return {
        success: false,
        failure: {
          originalFilename: file.name || `file-${index}`,
          reason: `Failed to process image: ${error instanceof Error ? error.message : 'Unknown error'}`,
          step: 'processing'
        }
      }
    }
  })

  const images: ProcessedImage[] = []
  const failed: FailedItem[] = []

  processed.forEach(result => {
    if (result.success) {
      images.push(result.image)
    } else {
      failed.push(result.failure)
    }
  })

  if (images.length === 0) {
    return { images, failed }
  }

  const totalSize = images.reduce((sum, img) => sum + img.buffer.length, 0)
  const maxPayloadSize = 12 * 1024 * 1024

  console.log(`Initial payload: ${(totalSize / 1024 / 1024).toFixed(2)}MB with ${images.length} images`)

  const compressionLimit = Math.min(NORMALIZE_CONCURRENCY, images.length)

  await mapWithConcurrency(images, compressionLimit, async (image, index) => {
    const originalSize = image.buffer.length
    const targetSize = Math.floor((maxPayloadSize / images.length) * 0.7)

    let quality = originalSize <= targetSize ? 0.85 : 0.7
    let dimension = originalSize <= targetSize ? 1400 : 1200
    let attempts = 0

    while (image.buffer.length > targetSize && attempts < 8) {
      try {
        const compressedBuffer = await sharp(image.buffer)
          .jpeg({
            quality: Math.round(quality * 100),
            progressive: true,
            mozjpeg: true
          })
          .resize({
            width: dimension,
            height: dimension,
            fit: 'inside',
            withoutEnlargement: true
          })
          .toBuffer()

        image.buffer = compressedBuffer

        if (compressedBuffer.length <= targetSize) {
          break
        }

        quality = Math.max(0.4, quality - 0.1)
        dimension = Math.max(800, dimension - 100)
        attempts++
      } catch (error) {
        console.error(`Failed to compress image ${image.originalName || `image-${index}`}:`, error)
        break
      }
    }
  })

  const finalTotalSize = images.reduce((sum, img) => sum + img.buffer.length, 0)
  console.log(`Final payload: ${(finalTotalSize / 1024 / 1024).toFixed(2)}MB (reduction: ${(((totalSize - finalTotalSize) / totalSize) * 100).toFixed(1)}%)`)

  if (finalTotalSize > maxPayloadSize) {
    console.warn(`⚠️ WARNING: Final payload ${(finalTotalSize / 1024 / 1024).toFixed(2)}MB still exceeds ${(maxPayloadSize / 1024 / 1024).toFixed(1)}MB Railway premium target!`)
  }

  return { images, failed }
}
