import { lazy, type ComponentType } from 'react'

/**
 * Route-split pages, hardened against a stale open tab.
 *
 * Every deployment gives the JS chunks new hashed filenames, so a tab that
 * was loaded before a deploy is holding an index that points at files which
 * no longer exist. The moment the user opens a page they haven't visited
 * yet, that dynamic import 404s and React surfaces the error boundary --
 * "something went wrong, reload" -- even though nothing is actually broken.
 * The reload fixes it because it fetches the new index, which is exactly why
 * the failure looked so arbitrary.
 *
 * So: on a chunk-loading failure, reload once and let the page open on the
 * new build. A sessionStorage marker keyed per chunk keeps that to a single
 * attempt, so a genuine and persistent failure still reaches the error
 * boundary instead of trapping the user in a reload loop.
 */

const RELOAD_MARKER = 'tqfy_chunk_reloaded:'

/** A failed dynamic import, as reported by browsers (wording varies). */
function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return /Loading chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(message)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRecovery<T extends ComponentType<any>>(
  name: string,
  factory: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    const marker = RELOAD_MARKER + name
    try {
      const mod = await factory()
      // Opened cleanly, so let a future stale-chunk failure reload again.
      sessionStorage.removeItem(marker)
      return mod
    } catch (error) {
      if (isChunkLoadError(error) && !sessionStorage.getItem(marker)) {
        sessionStorage.setItem(marker, '1')
        window.location.reload()
        // Never resolves; the reload replaces this document.
        return new Promise<{ default: T }>(() => {})
      }
      throw error
    }
  })
}
