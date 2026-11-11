import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base './' lets the built app run from any static host / sub-folder (e.g. GitHub Pages)
export default defineConfig({
  base: './',
  plugins: [react()],
})
