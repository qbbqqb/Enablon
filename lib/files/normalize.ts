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

  // ALWAYS apply aggressive compression for Vercel deployment
  const totalSize = images.reduce((sum, img) => sum + img.buffer.length, 0)
  const maxPayloadSize = 3 * 1024 * 1024 // 3MB to be very safe for Vercel

  console.log(`Initial payload: ${(totalSize / 1024 / 1024).toFixed(2)}MB with ${images.length} images`)

  // Always compress aggressively for Vercel deployment
  for (let i = 0; i < images.length; i++) {
    const image = images[i]
    const originalSize = image.buffer.length
    const targetSize = Math.floor((maxPayloadSize / images.length) * 0.7) // Target 70% of available per image (conservative)

    console.log(`Compressing image ${i + 1}/${images.length}: ${image.originalName} (${(originalSize / 1024).toFixed(0)}KB → target: ${(targetSize / 1024).toFixed(0)}KB)`)

    // Start with very aggressive settings for Vercel
    let quality = 0.3
    let dimension = 600

    // If image is already small enough, still compress but less aggressively
    if (originalSize <= targetSize) {
      quality = 0.5
      dimension = 800
    }

    let attempts = 0
    const maxAttempts = 8

    while (image.buffer.length > targetSize && attempts < maxAttempts) {
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

        console.log(`  Attempt ${attempts + 1}: quality=${(quality * 100).toFixed(0)}%, dimension=${dimension}px → ${(compressedBuffer.length / 1024).toFixed(0)}KB`)

        image.buffer = compressedBuffer

        if (compressedBuffer.length <= targetSize) {
          break
        }

        // More aggressive reduction
        quality = Math.max(0.15, quality - 0.05)
        dimension = Math.max(400, dimension - 100)
        attempts++

      } catch (error) {
        console.error(`Failed to compress image ${image.originalName}:`, error)
        break
      }
    }

    console.log(`  Final: ${image.originalName} compressed from ${(originalSize / 1024).toFixed(0)}KB to ${(image.buffer.length / 1024).toFixed(0)}KB`)
  }

  const finalTotalSize = images.reduce((sum, img) => sum + img.buffer.length, 0)
  console.log(`Final payload: ${(finalTotalSize / 1024 / 1024).toFixed(2)}MB (reduction: ${(((totalSize - finalTotalSize) / totalSize) * 100).toFixed(1)}%)`)

  if (finalTotalSize > maxPayloadSize) {
    console.warn(`⚠️ WARNING: Final payload ${(finalTotalSize / 1024 / 1024).toFixed(2)}MB still exceeds ${(maxPayloadSize / 1024 / 1024).toFixed(1)}MB limit!`)
  }

  return { images, failed }
}