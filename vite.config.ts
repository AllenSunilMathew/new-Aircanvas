import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    port: 5173
    allowedHosts: ['aircanvas-498q.onrender.com'],
  },
  build: {
    target: 'esnext'
  }
});
