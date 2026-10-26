import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Some machines set NODE_ENV=production globally, which makes Vitest resolve
// React's production bundle and breaks RTL's act(). Tests always run in test mode.
if (process.env.NODE_ENV === 'production' && process.env.VITEST) {
  process.env.NODE_ENV = 'test'
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5001',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
  },
})
