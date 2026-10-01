/**
 * `GET /plugins/better-display/image?url=…`: fetch a picture shown in the transcript for the
 * browser, which usually may not read other sites' images (CORS) when attaching them to a
 * message. Only public http(s) addresses, only `image/*`, at most 10 MB, 15 s; every redirect hop
 * is checked again so the route cannot reach the local network.
 */
import { lookup } from 'node:dns/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isIP } from 'node:net'

export const IMAGE_PROXY_PATH = '/plugins/better-display/image'
const MAX_BYTES = 10 * 1024 * 1024
const TIMEOUT_MS = 15_000
const MAX_REDIRECTS = 3

/** Loopback, private, link-local, CGNAT, multicast and other non-public ranges. */
export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const lower = address.toLowerCase()
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)
    if (mapped) return isPrivateAddress(mapped[1]!)
    return lower === '::' || lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith('ff')
  }
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b] = parts as [number, number, number, number]
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
}

async function assertPublic(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('only http(s) images')
  if (url.username !== '' || url.password !== '') throw new Error('credentials in URL')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(host) !== 0 ? [host] : (await lookup(host, { all: true })).map(entry => entry.address)
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw new Error('address not allowed')
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>

/** Fetch with redirects followed by hand, each hop checked. */
export async function fetchPublicImage(raw: string, signal: AbortSignal, fetcher: FetchLike = fetch): Promise<{ type: string, data: Uint8Array }> {
  let url = new URL(raw)
  for (let hop = 0; ; hop++) {
    await assertPublic(url)
    const response = await fetcher(url.href, { redirect: 'manual', signal, headers: { accept: 'image/*' } })
    if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
      if (hop >= MAX_REDIRECTS) throw new Error('too many redirects')
      url = new URL(response.headers.get('location')!, url)
      continue
    }
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
    const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
    if (!type.startsWith('image/')) throw new Error('not an image')
    const declared = Number(response.headers.get('content-length') ?? 0)
    if (declared > MAX_BYTES) throw new Error('image too large')
    const reader = response.body?.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    while (reader !== undefined) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_BYTES) {
        void reader.cancel()
        throw new Error('image too large')
      }
      chunks.push(value)
    }
    const data = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      data.set(chunk, offset)
      offset += chunk.byteLength
    }
    return { type, data }
  }
}

function sendError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify({ error: message }))
}

export function imageProxyRoute(fetcher?: FetchLike) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'GET') return sendError(res, 405, 'method-not-allowed')
    if (req.headers['sec-fetch-site'] === 'cross-site') return sendError(res, 403, 'cross-site')
    const target = new URL(req.url ?? '/', 'http://local').searchParams.get('url')
    if (target === null) return sendError(res, 400, 'url required')
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort(new Error('timeout')) }, TIMEOUT_MS)
    res.once('close', () => { controller.abort() })
    try {
      const image = await fetchPublicImage(target, controller.signal, fetcher)
      res.writeHead(200, { 'content-type': image.type, 'content-length': String(image.data.byteLength), 'cache-control': 'private, max-age=600', 'x-content-type-options': 'nosniff' })
      res.end(image.data)
    } catch (error) {
      sendError(res, 502, error instanceof Error ? error.message : String(error))
    } finally {
      clearTimeout(timer)
    }
  }
}
