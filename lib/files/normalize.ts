import sharp from 'sharp'
import { CONSTANTS } from '../constants/enums'
import type { ProcessedImage, FailedItem } from '../types'

export async function normalizeImages(files: any[]): Promise<{
  images: ProcessedImage[]
  failed: FailedItem[]
}> {
  const images: ProcessedImage[] = []
  const failed: FailedItem[] = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]

    try {
      // Convert file to buffer - handle both browser File objects and Node.js FormData entries
      let inputBuffer: Buffer
      if (file.arrayBuffer && typeof file.arrayBuffer === 'function') {
        // Browser File object
        const arrayBuffer = await file.arrayBuffer()
        inputBuffer = Buffer.from(arrayBuffer)
      } else if (file.stream && typeof file.stream === 'function') {
        // Node.js FormData file entry
        const chunks: Uint8Array[] = []
        const reader = file.stream().getReader()

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
        }

        // Combine all chunks into a single buffer
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
          originalFilename: file.name || `file-${i}`,
          reason: `File still too large after compression: ${(processedBuffer.length / 1024 / 1024).toFixed(1)}MB > 10MB`,
          step: 'processing'
        })
        continue
      }

      images.push({
        originalIndex: i,
        originalName: file.name || `image-${i}.jpg`,
        buffer: processedBuffer,
        mimeType: 'image/jpeg'
      })
      
    } catch (error) {
      failed.push({
        originalFilename: file.name || `file-${i}`,
        reason: `Failed to process image: ${error instanceof Error ? error.message : 'Unknown error'}`,
        step: 'processing'
      })
    }
  }

  // Apply moderate compression for Railway deployment
  const totalSize = images.reduce((sum, img) => sum + img.buffer.length, 0)
  const maxPayloadSize = 8 * 1024 * 1024 // 8MB target for Railway (more generous than Vercel)

  console.log(`Initial payload: ${(totalSize / 1024 / 1024).toFixed(2)}MB with ${images.length} images`)

  // Compress moderately for Railway deployment (better quality than Vercel settings)
  for (let i = 0; i < images.length; i++) {
    const image = images[i]
    const originalSize = image.buffer.length
    const targetSize = Math.floor((maxPayloadSize / images.length) * 0.7) // Target 70% of available per image (conservative)

    console.log(`Compressing image ${i + 1}/${images.length}: ${image.originalName} (${(originalSize / 1024).toFixed(0)}KB → target: ${(targetSize / 1024).toFixed(0)}KB)`)

    // Start with moderate settings for Railway
    let quality = 0.5
    let dimension = 900

    // If image is already small enough, use higher quality
    if (originalSize <= targetSize) {
      quality = 0.7
      dimension = 1000
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

        // More gentle reduction for better quality
        quality = Math.max(0.25, quality - 0.08)
        dimension = Math.max(600, dimension - 80)
        attempts++

      } catch (error) {
        console.error(`Failed to compress image ${image.originalName || 'unknown'}:`, error)
        break
      }
    }

    console.log(`  Final: ${image.originalName || 'unknown'} compressed from ${(originalSize / 1024).toFixed(0)}KB to ${(image.buffer.length / 1024).toFixed(0)}KB`)
  }

  const finalTotalSize = images.reduce((sum, img) => sum + img.buffer.length, 0)
  console.log(`Final payload: ${(finalTotalSize / 1024 / 1024).toFixed(2)}MB (reduction: ${(((totalSize - finalTotalSize) / totalSize) * 100).toFixed(1)}%)`)

  if (finalTotalSize > maxPayloadSize) {
    console.warn(`⚠️ WARNING: Final payload ${(finalTotalSize / 1024 / 1024).toFixed(2)}MB still exceeds ${(maxPayloadSize / 1024 / 1024).toFixed(1)}MB Railway target!`)
  }

  return { images, failed }
}