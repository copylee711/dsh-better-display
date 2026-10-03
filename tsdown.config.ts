import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'

const PACKAGE_NAME = '@copylee/dsh-better-display'
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  
  '@terrastruct/d2',
  '@antv/infographic',
]
const CSS_PREFIX = '\0dsh-better-display-css:'
const CSS_SUFFIX = '.mjs'
const STREAM_MONACO_STUB = '\0dsh-better-display-stream-monaco-stub'
const FONT_FACE_SRC = /src:url\((fonts\/[^)]+\.woff2)\) format\("woff2"\)[^;}]*/g

/**
 * Embed a stylesheet's woff2 fonts as data URIs (dropping woff/ttf fallbacks): the CSS is injected
 * as a <style> tag, so relative font URLs would resolve against the DSH page instead of the package.
 */
async function inlineFonts(css: string, cssPath: string): Promise<string> {
  const files = [...new Set([...css.matchAll(FONT_FACE_SRC)].map(match => match[1] as string))]
  const encoded = new Map(await Promise.all(files.map(async file =>
    [file, (await readFile(resolve(dirname(cssPath), file))).toString('base64')] as const)))
  return css.replace(FONT_FACE_SRC, (_all, file: string) => `src:url(data:font/woff2;base64,${encoded.get(file)}) format("woff2")`)
}

/**
 * Heavy, rarely-first-needed libraries live in package-local chunks the Host serves on demand
 * (`require.async('./client.<name>.js')`, DSH >= 0.2.0-rc.2) instead of in the boot bundle.
 * A chunk must be self-contained, so each one is its own build.
 */
const LAZY_CHUNKS: Record<string, { file: string; entry: string }> = {
  mermaid: { file: 'client.mermaid.js', entry: 'mermaid' },
  'stream-markdown': { file: 'client.code.js', entry: 'stream-markdown' },
}
const LAZY_IMPORT = new RegExp(`\\bimport\\((["'])(${Object.keys(LAZY_CHUNKS).join('|')})\\1\\)`, 'g')

function clientBuild(entry: Record<string, string>, fileName: string, chunk?: string) {
  return {
    entry,
    outDir: 'lib',
    format: 'cjs' as const,
    platform: 'browser' as const,
    target: 'es2022',
    dts: false,
    sourcemap: true,
    minify: true,
    clean: false,
    fixedExtension: false,
    deps: {
      neverBundle: CLIENT_EXTERNALS,
      alwaysBundle: (id: string) => CLIENT_EXTERNALS.includes(id) ? undefined : true,
      onlyBundle: false as const,
    },
    plugins: [{
      name: 'dsh-better-display-code-block-dependencies',
      resolveId(source: string) {
        if (source === 'shiki') return resolve('src/client/shiki.ts')
        if (source === 'stream-monaco') return STREAM_MONACO_STUB
        return null
      },
      load(id: string) {
        return id === STREAM_MONACO_STUB ? 'export {}' : null
      },
    }, {
      // Only the boot bundle defers: inside a chunk the same import is the chunk's own content.
      name: 'dsh-better-display-lazy-chunks',
      transform(code: string) {
        if (chunk !== undefined || !code.includes('import(')) return null
        LAZY_IMPORT.lastIndex = 0
        if (!LAZY_IMPORT.test(code)) return null
        return code.replace(LAZY_IMPORT, (_all, _quote: string, name: string) => `require.async(${JSON.stringify('./' + LAZY_CHUNKS[name]!.file)})`)
      },
    }, {
      name: 'dsh-better-display-css',
      async resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith('.css')) return null
        if (source.startsWith('.')) {
          if (importer === undefined) return null
          return CSS_PREFIX + resolve(dirname(importer), source) + CSS_SUFFIX
        }
        return CSS_PREFIX + fileURLToPath(import.meta.resolve(source)) + CSS_SUFFIX
      },
      async load(id: string) {
        if (!id.startsWith(CSS_PREFIX)) return null
        const path = id.slice(CSS_PREFIX.length, -CSS_SUFFIX.length)
        const css = await inlineFonts(await readFile(path, 'utf8'), path)
        const tagId = `dsh-better-display/${basename(path)}`
        return [
          `const tagId = ${JSON.stringify(tagId)};`,
          'if (document.querySelector(`style[data-plugin-css="${tagId}"]`) === null) {',
          '  const tag = document.createElement("style");',
          `  tag.dataset.plugin = ${JSON.stringify(PACKAGE_NAME)};`,
          '  tag.dataset.pluginCss = tagId;',
          `  tag.textContent = ${JSON.stringify(css)};`,
          '  document.head.appendChild(tag);',
          '}',
        ].join('\n')
      },
    }],
    outputOptions: {
      entryFileNames: fileName,
      codeSplitting: false,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_NAME)},${chunk === undefined ? '' : ` chunk: ${JSON.stringify(chunk)},`} factory: (require) => {`,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  }
}

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    dts: true,
    clean: true,
    fixedExtension: false,
  },
  clientBuild({ client: 'src/client/index.ts' }, 'client.js'),
  ...Object.values(LAZY_CHUNKS).map(chunk => clientBuild({ [chunk.file.slice(0, -3)]: chunk.entry }, chunk.file, chunk.file)),
])
