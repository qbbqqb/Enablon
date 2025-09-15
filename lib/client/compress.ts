// Client-side image compression utilities

export interface CompressedFile {
  file: File
  originalSize: number
  compressedSize: number
  compressionRatio: number
}

export async function compressImageFile(file: File, targetSizeKB: number = 1000): Promise<CompressedFile> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')

    if (!ctx) {
      reject(new Error('Canvas context not available'))
      return
    }

    img.onload = () => {
      // Calculate dimensions to fit within limits while maintaining aspect ratio
      const maxDimension = 1400 // Maximum quality for GC documentation
      const scale = Math.min(maxDimension / img.width, maxDimension / img.height, 1)

      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)

      // Draw and compress
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

      // Start with high quality for professional documentation
      let quality = 0.8
      const tryCompress = () => {
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('Failed to compress image'))
            return
          }

          const compressedSize = blob.size
          const targetSize = targetSizeKB * 1024

          if (compressedSize <= targetSize || quality <= 0.5) {
            // Create a new File from the blob
            const compressedFile = new File([blob], file.name, {
              type: 'image/jpeg',
              lastModified: Date.now()
            })

            resolve({
              file: compressedFile,
              originalSize: file.size,
              compressedSize: compressedFile.size,
              compressionRatio: file.size / compressedFile.size
            })
          } else {
            // Try with lower quality (gentler reduction)
            quality -= 0.1
            tryCompress()
          }
        }, 'image/jpeg', quality)
      }

      tryCompress()
    }

    img.onerror = () => {
      reject(new Error(`Failed to load image: ${file.name}`))
    }

    img.src = URL.createObjectURL(file)
  })
}

export async function compressFileBatch(files: File[], targetBatchSizeMB: number = 6): Promise<CompressedFile[]> {
  const targetSizePerFileKB = Math.floor((targetBatchSizeMB * 1024) / files.length)
  const compressed: CompressedFile[] = []

  console.log(`Client compression: ${files.length} files, target ${targetSizePerFileKB}KB per file`)

  for (let i = 0; i < files.length; i++) {
    const file = files[i]

    try {
      console.log(`Compressing ${i + 1}/${files.length}: ${file.name} (${(file.size / 1024).toFixed(0)}KB)`)

      // Only compress standard image formats that Canvas can handle
      if (file.type.startsWith('image/') && !file.name.toLowerCase().endsWith('.heic')) {
        const compressedResult = await compressImageFile(file, targetSizePerFileKB)
        compressed.push(compressedResult)
        console.log(`  → Compressed to ${(compressedResult.compressedSize / 1024).toFixed(0)}KB (${compressedResult.compressionRatio.toFixed(1)}x reduction)`)
      } else {
        // HEIC files and other formats - server will handle these
        console.log(`  → Skipping client compression for ${file.type || 'unknown type'}, server will handle`)
        compressed.push({
          file,
          originalSize: file.size,
          compressedSize: file.size,
          compressionRatio: 1
        })
      }
    } catch (error) {
      console.error(`Failed to compress ${file.name}:`, error)
      // Fall back to original file
      compressed.push({
        file,
        originalSize: file.size,
        compressedSize: file.size,
        compressionRatio: 1
      })
    }
  }

  const totalOriginalSize = compressed.reduce((sum, c) => sum + c.originalSize, 0)
  const totalCompressedSize = compressed.reduce((sum, c) => sum + c.compressedSize, 0)

  console.log(`Batch compression complete: ${(totalOriginalSize / 1024 / 1024).toFixed(1)}MB → ${(totalCompressedSize / 1024 / 1024).toFixed(1)}MB`)

  return compressed
}