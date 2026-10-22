import type { FlushotApi } from './index'

declare global {
  interface Window {
    flushot: FlushotApi
  }
}

export {}
