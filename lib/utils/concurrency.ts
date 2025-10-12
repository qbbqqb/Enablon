export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  iterator: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (limit <= 0) {
    throw new Error('Concurrency limit must be greater than zero')
  }

  const results: R[] = new Array(items.length)
  let cursor = 0

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const current = cursor
      if (current >= items.length) {
        break
      }
      cursor = current + 1
      results[current] = await iterator(items[current], current)
    }
  })

  await Promise.all(workers)
  return results
}
