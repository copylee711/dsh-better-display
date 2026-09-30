/** Workspace file access for Markdown pictures and links, mirroring DSH's built-in Chat renderer. */

import { createContext, useContext } from 'react'

/** What the Chat node owner tells this renderer about the session's workspace. */
export interface WorkspaceAccess {
  /** Session workspace root; relative paths resolve against it. */
  cwd?: string | undefined
  /** Open a workspace file in DSH's file viewer. */
  openFile?: ((path: string) => void) | undefined
}

const WorkspaceContext = createContext<WorkspaceAccess>({})

/** Provides workspace access to the Markstream components rendered inside one reply. */
export const WorkspaceProvider = WorkspaceContext.Provider

/** Read the nearest workspace access (empty outside a reply). */
export function useWorkspace(): WorkspaceAccess {
  return useContext(WorkspaceContext)
}

function isWindowsStylePath(value: string): boolean {
  return /^[A-Za-z]:[/\\]/.test(value) || value.startsWith('\\\\')
}

function isAbsoluteWorkspacePath(path: string): boolean {
  return path.startsWith('/') || isWindowsStylePath(path)
}

/** Join a workspace-relative path onto the workspace root, keeping absolute paths as they are. */
export function resolveWorkspacePath(cwd: string | undefined, path: string): string {
  if (isAbsoluteWorkspacePath(path) || cwd === undefined || cwd === '') return path
  const separator = isWindowsStylePath(cwd) && cwd.includes('\\') ? '\\' : '/'
  return `${cwd.replace(/[/\\]+$/, '')}${separator}${path.replace(/^[/\\]+/, '')}`
}

/**
 * Decode a Markdown destination that names a local file, or undefined for anything with a URL scheme.
 * @param url - authored destination (angle brackets already removed by the parser).
 */
export function localPath(url: string): string | undefined {
  const value = url.trim()
  if (value === '' || value.startsWith('//')) return undefined
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !isWindowsStylePath(value)) return undefined
  let path = value
  try {
    path = decodeURI(value)
  } catch { /* keep the raw spelling */ }
  const bare = path.split(/[?#]/u)[0] ?? ''
  return bare === '' || /[\u0000-\u001f\u007f]/u.test(bare) ? undefined : bare
}

/**
 * The DSH file API URL for a workspace file, as the built-in renderer builds it.
 * @param base - `document.baseURI` of the DSH page.
 * @param cwd - session workspace root.
 * @param path - absolute or workspace-relative path.
 * @returns the preview URL, or undefined when the path cannot be served.
 */
export function workspaceFileUrl(base: string, cwd: string | undefined, path: string): string | undefined {
  const absolute = resolveWorkspacePath(cwd, path)
  if (!/^https?:/u.test(base) && !base.startsWith('dsh-app://app/')) return undefined
  if (!isAbsoluteWorkspacePath(absolute) || /^[/\\]{2}/u.test(absolute)) return undefined
  return new URL(`api/file?path=${encodeURIComponent(absolute)}`, base).href
}
