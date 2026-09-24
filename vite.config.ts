import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      // In dev the browser hits Vite; API calls are forwarded to the Node proxy,
      // so the OpenRouter key never leaves the server side in any mode.
      '/api': 'http://localhost:8787',
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
