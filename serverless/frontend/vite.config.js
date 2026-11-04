import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  base: './',
  build: {
    outDir: fileURLToPath(new URL('../web/react/', import.meta.url)),
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false
  }
});
