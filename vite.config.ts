/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' keeps asset URLs relative so the build can be served from any sub-path.
export default defineConfig({
  plugins: [react()],
  base: './',
  // Inline (empty) PostCSS config: stops Vite searching parent folders for one.
  css: { postcss: {} },
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  server: { port: 5180, host: true },
  preview: { port: 4180, host: true },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
