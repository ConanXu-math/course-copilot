import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-expect-error The API is a plain Node module shared with the production server.
import { createApiMiddleware, disposeAgent } from './server/api.mjs';

export default defineConfig({
  plugins: [react(), {
    name: 'course-api',
    configureServer(server) {
      server.middlewares.use(createApiMiddleware());
      server.httpServer?.once('close', disposeAgent);
    },
    configurePreviewServer(server) {
      server.middlewares.use(createApiMiddleware());
      server.httpServer.once('close', disposeAgent);
    },
    closeBundle() { disposeAgent(); },
  }],
  server: { host: '127.0.0.1', port: 5173 },
  build: {
    rollupOptions: { output: { entryFileNames: 'assets/app.js', chunkFileNames: 'assets/[name].js', assetFileNames: 'assets/[name][extname]' } },
  },
});
