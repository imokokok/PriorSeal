import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const sdkPackage = JSON.parse(readFileSync(new URL('../sdk/package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig({
  plugins: [react()],
  define: {
    __PRIORSEAL_SDK_VERSION__: JSON.stringify(sdkPackage.version),
  },
  server: {
    proxy: {
      '/v1': 'http://localhost:3000',
      '/.well-known': 'http://localhost:3000'
    }
  }
})
