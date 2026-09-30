// jsdom's requestAnimationFrame never fires here, which would stall Markstream's smooth
// streaming pacer; drive it with a 60 Hz timer like a visible browser tab.
if (typeof window !== 'undefined') {
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    setTimeout(() => { callback(performance.now()) }, 16) as unknown as number) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = ((id: number) => { clearTimeout(id) }) as typeof cancelAnimationFrame
}
