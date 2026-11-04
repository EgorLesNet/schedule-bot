import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Compatibility for the first two React stages: their fallback referenced the old root index.
// Rewrite only those two source modules during bundling, never third-party code or other URLs.
function legacyFallbackRoutes() {
  return {
    name: 'schedule-legacy-fallback-routes',
    enforce: 'pre',
    transform(code, id) {
      const path = id.split('?')[0].replaceAll('\\', '/');
      if (!path.endsWith('/frontend/src/main.jsx') && !path.endsWith('/frontend/src/ui.jsx')) return null;
      if (!code.includes("'../index.html'")) return null;
      return { code: code.replaceAll("'../index.html'", "'../legacy.html'"), map: null };
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [legacyFallbackRoutes()],
  build: {
    outDir: fileURLToPath(new URL('../web/react/', import.meta.url)),
    emptyOutDir: true,
    manifest: 'manifest.json',
    target: 'es2020',
    sourcemap: false
  }
});
