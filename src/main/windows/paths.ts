import { join } from 'node:path'

/** URL of a renderer HTML entry, honouring the electron-vite dev server. */
export function rendererUrl(entry: 'overlay' | 'settings'): { kind: 'url' | 'file'; value: string } {
  const devServer = process.env.ELECTRON_RENDERER_URL
  if (devServer) {
    return { kind: 'url', value: `${devServer}/${entry}/index.html` }
  }
  return { kind: 'file', value: join(__dirname, `../renderer/${entry}/index.html`) }
}

export function preloadPath(): string {
  return join(__dirname, '../preload/index.cjs')
}
