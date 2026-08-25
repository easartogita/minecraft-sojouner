import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Static-site build target: produces a plain browser bundle (no Tauri runtime
// reachable anywhere in it) that reads an exported bundle (manifest.json +
// tiles/ + data/, see src/renderer/lib/staticExport/schema.ts) instead of
// talking to the Tauri backend. The only difference from vite.config.ts is
// this one alias — every `import ... from '.../tauriAPI'` (any relative
// depth, including sibling imports from within lib/ itself) resolves to
// tauriAPI.static.ts instead, matching signatures so nothing else needs to
// change. The regex must match the *whole* specifier (`^...$`), not just a
// trailing segment — rollup-plugin-alias's find/replace only substitutes the
// matched span, so a partial match like `/\/tauriAPI$/` leaves the
// unmatched leading `./` or `../` glued onto the (absolute) replacement,
// silently mangling it into a bogus relative path.
//
// The App shell boots from manifest.json when IS_STATIC_SITE is true
// (tauriAPI.static.ts), so this alias is the whole frontend fork.
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@renderer', replacement: resolve(__dirname, 'src/renderer') },
      { find: /^.*tauriAPI$/, replacement: resolve(__dirname, 'src/renderer/lib/tauriAPI.static.ts') },
    ],
  },
  // Relative asset paths — the export can land at any subpath (e.g.
  // /26.3/), not just a domain root, and an absolute `/assets/...` base
  // resolves against the domain root regardless of where index.html
  // actually is.
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist-site'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/renderer/index.html'),
    },
  },
  assetsInclude: ['**/*.wasm'],
})
