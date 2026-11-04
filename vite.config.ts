import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import license from 'rollup-plugin-license'

export default defineConfig({
  // Relative asset paths so the build can be served from any sub-path (e.g. /webclient3/).
  base: './',
  plugins: [
    preact(),
    license({
      thirdParty: {
        includePrivate: false,
        output: { file: 'dist/THIRD-PARTY-LICENSES.txt' },
      },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
    // In development, borrow config and the account API from a running server
    // (set API_TARGET), so requests stay same-origin.
    proxy: process.env.API_TARGET
      ? {
          '/api': { target: process.env.API_TARGET, changeOrigin: true },
          '/webclient-config': { target: process.env.API_TARGET, changeOrigin: true },
        }
      : undefined,
  },
})
