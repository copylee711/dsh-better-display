// Guard the browser bundle against regressions the unit tests cannot see (they run on sources).
import { readFileSync } from 'node:fs'

const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const checks = {
  'KaTeX 0.18 stylesheet (prefixed class names)': bundle.includes('katex-sizing'),
  'KaTeX fonts embedded as woff2 data URIs': (bundle.match(/data:font\/woff2;base64/g) ?? []).length >= 20,
  'no relative KaTeX font URLs': !bundle.includes('url(fonts/'),
  'table styles': bundle.includes('.dsh-better-display__markdown :is(th, td)'),
  'GitHub code themes': bundle.includes('github-light') && bundle.includes('github-dark-default'),
  'code block shell styles': bundle.includes('.dsh-better-display__code-header'),
  'non-italic blockquotes': bundle.includes('.dsh-better-display__markdown .blockquote-node'),
  'block enter fade (not Markstream fade mode)': bundle.includes('dsh-better-display-enter'),
  'markdown root always painted': bundle.includes('.dsh-better-display__markdown .markdown-renderer'),
  'ModuleLoader banner': bundle.startsWith('window.__ModuleLoader__.load('),
}
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name)
if (failed.length > 0) {
  console.error(`bundle check failed:\n- ${failed.join('\n- ')}`)
  process.exit(1)
}
console.log(`bundle check passed (${Object.keys(checks).length} checks)`)
