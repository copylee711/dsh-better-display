/**
 * What the renderer needs to know about code highlighting without loading the highlighter:
 * `shiki.ts` (grammars and all) is only fetched when the first code block appears.
 */

/** Code block colours: GitHub's palettes read closest to ChatGPT's and stay soft on DSH surfaces. */
export const CODE_THEME_LIGHT = 'github-light'
export const CODE_THEME_DARK = 'github-dark-default'
export const CODE_THEMES = Object.freeze([CODE_THEME_LIGHT, CODE_THEME_DARK])

/** Languages with a bundled grammar; `shiki.ts` must provide exactly these. */
export const SHIKI_LANGUAGES = Object.freeze([
  'bash', 'c', 'cpp', 'csharp', 'css', 'dart', 'dockerfile', 'go', 'html', 'java', 'javascript', 'json', 'jsx',
  'kotlin', 'lua', 'markdown', 'objective-c', 'objective-cpp', 'php', 'powershell', 'python', 'ruby', 'rust',
  'scala', 'shellscript', 'sql', 'svelte', 'swift', 'toml', 'tsx', 'typescript', 'vue', 'xml', 'yaml',
] as const)
