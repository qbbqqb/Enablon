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
  
  return { images, failed }
}