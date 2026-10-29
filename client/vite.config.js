import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// A module id inside one of these packages (`names` is a RegExp alternation). [\\/] matches the
// path separator on every OS.
const inPackages = (names) => new RegExp(String.raw`[\\/]node_modules[\\/](?:${names})[\\/]`)

// Vendor chunks (Rolldown's output.codeSplitting; Vite 8 builds with Rolldown). Each library gets
// its own file, so a deploy that changes only app code leaves the vendor files cached, and no chunk
// passes Vite's 500 kB warning. A group's chunk loads only where something imports it: Headless UI
// with the header bell and the dialogs, browser-image-compression (no group) with the photo
// uploaders. A captured module brings its own dependencies along, so a group names only the
// packages the app imports, and the higher priority claims a shared dependency first (React is
// everyone's). date-fns has a group so that if a page starts using it, it lands in its own file
// rather than inside that page; nothing imports it today.
const vendorGroups = [
  { name: 'react', test: inPackages('react|react-dom|scheduler|react-router|react-router-dom'), priority: 50 },
  { name: 'query', test: inPackages(String.raw`@tanstack[\\/](?:query-core|react-query)`), priority: 40 },
  { name: 'headlessui', test: inPackages('@headlessui'), priority: 40 },
  { name: 'date-fns', test: inPackages('date-fns|date-fns-tz'), priority: 40 },
  { name: 'icons', test: inPackages('lucide-react'), priority: 40 },
  { name: 'motion', test: inPackages('framer-motion|motion-dom|motion-utils'), priority: 40 },
  { name: 'forms', test: inPackages(String.raw`zod|react-hook-form|@hookform[\\/]resolvers`), priority: 30 },
  // What every page loads besides (axios, sonner, zustand…). '$initial': only the libraries the
  // entry imports statically, so a library only some lazy page needs stays with that page.
  { name: 'vendor', test: /[\\/]node_modules[\\/]/, tags: ['$initial'], priority: 10 },
]

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: { groups: vendorGroups },
        // Run modules in source order whatever chunk they land in. Without it, Rolldown can put its
        // CommonJS helpers (__commonJSMin) in an app chunk that imports the vendor chunk, which
        // imports the helpers back: React then runs before they exist, and the whole app is a blank
        // page ("t is not a function"). Main's build on 30 Oct did exactly that on Vercel, although
        // the build itself passed. About 4% more code.
        strictExecutionOrder: true,
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
})
