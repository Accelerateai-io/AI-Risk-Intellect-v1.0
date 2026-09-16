import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5176,
    proxy: {
      // Use `/api/` (with trailing slash) so `/api-keys` SPA route is not proxied.
      "/api/": {
        target: "http://localhost:5005",
        changeOrigin: true,
      },
    },
  },
})
