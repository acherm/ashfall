import { defineConfig } from 'vite';

// GitHub Pages serves project sites under https://<user>.github.io/<repo>/, so
// asset URLs must be RELATIVE ('./') rather than root-absolute ('/') — otherwise
// the bundled JS 404s on the subpath. './' works on any repo name and also under
// a custom domain, with no hardcoding.
export default defineConfig({
  base: './',
  build: {
    // the three.js bundle is legitimately large; don't warn about it
    chunkSizeWarningLimit: 2000,
  },
});
