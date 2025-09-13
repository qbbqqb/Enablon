import sharp from 'sharp'
import { CONSTANTS } from '../constants/enums'
import type { ProcessedImage, FailedItem } from '../types'

export async function normalizeImages(files: File[]): Promise<{
  images: ProcessedImage[]
  failed: FailedItem[]
}> {
  const images: ProcessedImage[] = []
  const failed: FailedItem[] = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    
    try {
      // Convert file to buffer
      const arrayBuffer = await file.arrayBuffer()
      const inputBuffer = Buffer.from(arrayBuffer)
      
      // Process with sharp
      let processedBuffer = await sharp(inputBuffer)
        .jpeg({ quality: Math.round(CONSTANTS.IMAGE_QUALITY * 100) })
        .resize({
          width: CONSTANTS.IMAGE_MAX_DIMENSION,
          height: CONSTANTS.IMAGE_MAX_DIMENSION,
          fit: 'inside',
          withoutEnlargement: true
        })
        .toBuffer()
      
      // Check if still too large after compression
      if (processedBuffer.length > CONSTANTS.MAX_FILE_SIZE) {
        failed.push({
          originalFilename: file.name,
          reason: `File still too large after compression: ${(processedBuffer.length / 1024 / 1024).toFixed(1)}MB > 10MB`,
          step: 'processing'
        })
        continue
      }
      
      images.push({
        originalIndex: i,
        originalName: file.name,
        buffer: processedBuffer,
        mimeType: 'image/jpeg'
      })
      
    } catch (error) {
      failed.push({
        originalFilename: file.name,
        reason: `Failed to process image: ${error instanceof Error ? error.message : 'Unknown error'}`,
        step: 'processing'
      })
    }
  }

  // Check total payload size and compress further if needed for Vercel limits (4.5MB)
  const totalSize = images.reduce((sum, img) => sum + img.buffer.length, 0)
  const maxPayloadSize = 4 * 1024 * 1024 // 4MB to be safe

  if (totalSize > maxPayloadSize) {
    console.log(`Total payload ${(totalSize / 1024 / 1024).toFixed(1)}MB exceeds limit, applying aggressive compression...`)

    for (let i = 0; i < images.length; i++) {
      const image = images[i]
      const targetSize = Math.floor(maxPayloadSize / images.length * 0.8) // Target 80% of available per image

      let quality = 0.5
      let dimension = 1000

      while (image.buffer.length > targetSize && quality > 0.2) {
        try {
          const compressedBuffer = await sharp(image.buffer)
            .jpeg({ quality: Math.round(quality * 100) })
            .resize({
              width: dimension,
              height: dimension,
              fit: 'inside',
              withoutEnlargement: true
            })
            .toBuffer()

          if (compressedBuffer.length < targetSize || quality <= 0.2) {
            image.buffer = compressedBuffer
            break
          }

          quality -= 0.1
          if (quality <= 0.3) {
            dimension = Math.max(800, dimension - 200)
          }

        } catch (error) {
          console.error(`Failed to compress image ${image.originalName}:`, error)
          break
        }
      }
    }

    const newTotalSize = images.reduce((sum, img) => sum + img.buffer.length, 0)
    console.log(`Compressed payload from ${(totalSize / 1024 / 1024).toFixed(1)}MB to ${(newTotalSize / 1024 / 1024).toFixed(1)}MB`)
  }

  return { images, failed }
}