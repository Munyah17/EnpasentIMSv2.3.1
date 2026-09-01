/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://localhost/' } },
    setupFiles: ['./src/test/setup.ts'],
    // Node 22+'s built-in experimental `localStorage` shadows jsdom's
    // window.localStorage in the test worker process unless disabled.
    execArgv: ['--no-experimental-webstorage'],
  },
})
