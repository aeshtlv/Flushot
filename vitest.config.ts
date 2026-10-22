import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The forks pool spawns child processes, which some locked-down environments
    // deny; a single threaded worker keeps `npm test` working there.
    pool: 'threads',
    maxWorkers: 1,
    isolate: false,
    testTimeout: 30_000,
    hookTimeout: 30_000
  }
})
