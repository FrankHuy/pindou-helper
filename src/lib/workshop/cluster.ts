import { colorDistance } from '../color-match'
import type { BeadColor } from '../palette'
import type { UncertainCluster, UncertainSample } from './types'

// Dummy BeadColor used only to interface with colorDistance (which expects BeadColor.rgb)
const toBeadColor = (rgb: [number, number, number]): BeadColor =>
  ({ brand: '', series: '', code: '', name: '', hex: '', rgb })

/**
 * Cluster uncertain RGB samples into at most `maxK` groups using
 * greedy farthest-first seeding + 2 iterations of k-means refinement.
 *
 * Returns clusters sorted by pixel count descending.
 */
export function clusterUncertainColors(
  samples: UncertainSample[],
  maxK = 10,
): UncertainCluster[] {
  if (samples.length === 0) return []

  // Deduplicate RGB values for centroid efficiency
  const uniqueRgbs: [number, number, number][] = []
  const rgbCounts: number[] = []
  const rgbToUniIdx = new Map<string, number>()
  const sampleToUniIdx: number[] = []

  for (const sample of samples) {
    const key = `${sample.rgb[0]},${sample.rgb[1]},${sample.rgb[2]}`
    let uniIdx = rgbToUniIdx.get(key)
    if (uniIdx === undefined) {
      uniIdx = uniqueRgbs.length
      uniqueRgbs.push(sample.rgb)
      rgbCounts.push(0)
      rgbToUniIdx.set(key, uniIdx)
    }
    rgbCounts[uniIdx] += 1
    sampleToUniIdx.push(uniIdx)
  }

  const uniqueCount = uniqueRgbs.length

  // If fewer uniques than maxK, each unique is its own cluster
  if (uniqueCount <= maxK) {
    return uniqueRgbs.map((rgb, id) => {
      const indices: number[] = []
      for (let i = 0; i < samples.length; i++) {
        if (sampleToUniIdx[i] === id) indices.push(i)
      }
      return {
        id,
        representative: rgb,
        count: rgbCounts[id],
        indices,
      }
    }).sort((a, b) => b.count - a.count)
  }

  // Farthest-first seeding for K centroids
  const centroids: [number, number, number][] = []
  // Start: most frequent unique RGB
  let startIdx = 0
  let maxCount = 0
  for (let i = 0; i < uniqueCount; i++) {
    if (rgbCounts[i] > maxCount) {
      maxCount = rgbCounts[i]
      startIdx = i
    }
  }
  centroids.push(uniqueRgbs[startIdx])

  while (centroids.length < maxK) {
    let farthestIdx = 0
    let farthestDist = -1
    for (let i = 0; i < uniqueCount; i++) {
      // Skip already-used as centroid
      if (centroids.some((c) =>
        c[0] === uniqueRgbs[i][0] && c[1] === uniqueRgbs[i][1] && c[2] === uniqueRgbs[i][2]
      )) continue

      // Min distance to any existing centroid
      let minDist = Infinity
      for (const c of centroids) {
        const d = colorDistance(uniqueRgbs[i], toBeadColor(c))
        if (d < minDist) minDist = d
      }
      // Weight by count to prefer populous clusters
      const score = minDist * Math.sqrt(rgbCounts[i])
      if (score > farthestDist) {
        farthestDist = score
        farthestIdx = i
      }
    }
    centroids.push(uniqueRgbs[farthestIdx])
  }

  // K-means assignment + centroid update (2 iterations)
  let assignments: number[] = new Array(uniqueCount).fill(0)
  for (let iter = 0; iter < 2; iter++) {
    // Assignment pass
    for (let i = 0; i < uniqueCount; i++) {
      let minDist = Infinity
      let bestK = 0
      for (let k = 0; k < centroids.length; k++) {
        const d = colorDistance(uniqueRgbs[i], toBeadColor(centroids[k]))
        if (d < minDist) {
          minDist = d
          bestK = k
        }
      }
      assignments[i] = bestK
    }

    // Centroid update
    for (let k = 0; k < centroids.length; k++) {
      let totalR = 0, totalG = 0, totalB = 0, totalW = 0
      for (let i = 0; i < uniqueCount; i++) {
        if (assignments[i] === k) {
          const w = rgbCounts[i]
          totalR += uniqueRgbs[i][0] * w
          totalG += uniqueRgbs[i][1] * w
          totalB += uniqueRgbs[i][2] * w
          totalW += w
        }
      }
      if (totalW > 0) {
        centroids[k] = [
          Math.round(totalR / totalW),
          Math.round(totalG / totalW),
          Math.round(totalB / totalW),
        ]
      }
    }
  }

  // Build clusters from unique assignment
  const clusterMap = new Map<number, { indices: number[]; count: number }>()
  for (let k = 0; k < centroids.length; k++) {
    clusterMap.set(k, { indices: [], count: 0 })
  }

  for (let i = 0; i < samples.length; i++) {
    const uniIdx = sampleToUniIdx[i]
    const k = assignments[uniIdx]
    const cluster = clusterMap.get(k)!
    cluster.indices.push(i)
    cluster.count += 1
  }

  const clusters: UncertainCluster[] = []
  for (const [k, info] of clusterMap) {
    if (info.count === 0) continue
    clusters.push({
      id: k,
      representative: centroids[k],
      count: info.count,
      indices: info.indices,
    })
  }

  clusters.sort((a, b) => b.count - a.count)
  // Reassign sequential ids after sort
  clusters.forEach((c, i) => (c.id = i))
  return clusters
}
