declare module '*.css'

/** Vite raw text imports (test fixtures). */
declare module '*?raw' {
  const text: string
  export default text
}
