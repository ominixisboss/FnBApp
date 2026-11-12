import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base './' lets the built app run from any static host / sub-folder (e.g. GitHub Pages)
export default defineConfig({
  base: './',
  plugins: [react()],
  // during `npm run dev`, forward API + websocket calls to the local server (`npm run server`)
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
})
