import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base must match the GitHub Pages repo path: https://<user>.github.io/twentyfour/
export default defineConfig({
  base: '/twentyfour/',
  plugins: [react()],
});
