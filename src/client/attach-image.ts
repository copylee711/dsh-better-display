/**
 * Put pictures shown in the transcript into the composer as image attachments. The page's own
 * images (workspace files, dsh-image-gen jobs) are fetched directly; other sites usually refuse
 * cross-origin reads, so those go through this plugin's Host route. Formats the model cannot take
 * (SVG, AVIF, …) are re-encoded as PNG.
 */

/** Host route that fetches a remote picture for the browser (see src/index.ts). */
export const IMAGE_PROXY_ROUTE = 'plugins/better-display/image'
const ACCEPTED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }

function sameOrigin(src: string): boolean {
  try {
    const url = new URL(src, document.baseURI)
    return url.protocol === 'blob:' || url.protocol === 'data:' || url.origin === new URL(document.baseURI).origin
  } catch {
    return false
  }
}

/** Media type from the file's magic bytes (servers often send octet-stream for workspace files). */
export function sniffImageType(bytes: Uint8Array): string | undefined {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value)
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png'
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif'
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  return undefined
}

async function fetchBlob(url: string): Promise<Blob> {
  const response = await fetch(url, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const header = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
  const type = sniffImageType(bytes) ?? (header.startsWith('image/') ? header : '')
  return new Blob([bytes], { type })
}

/** Bytes of a shown picture: directly when allowed, else through the Host. */
export async function loadImage(src: string): Promise<Blob> {
  if (sameOrigin(src)) return fetchBlob(src)
  try {
    return await fetchBlob(src)
  } catch {
    return fetchBlob(new URL(`${IMAGE_PROXY_ROUTE}?url=${encodeURIComponent(src)}`, document.baseURI).href)
  }
}

async function toPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
  bitmap.close()
  return new Promise((resolve, reject) => {
    canvas.toBlob(png => { png === null ? reject(new Error('cannot encode PNG')) : resolve(png) }, 'image/png')
  })
}

function fileName(alt: string, type: string): string {
  const base = alt.replace(/[\\/:*?"<>|\s]+/g, ' ').trim().slice(0, 40) || 'image'
  return `${base}.${EXTENSIONS[type] ?? 'png'}`
}

/** A File the composer accepts as an image attachment. */
export async function imageFile(src: string, alt = ''): Promise<File> {
  let blob = await loadImage(src)
  if (!ACCEPTED.has(blob.type)) blob = await toPng(blob)
  return new File([blob], fileName(alt, blob.type), { type: blob.type })
}
