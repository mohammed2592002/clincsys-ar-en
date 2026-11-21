import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        '@': path.resolve(__dirname, './src'),
        'firebase/app': path.resolve(__dirname, './src/dbClient.ts'),
        'firebase/firestore': path.resolve(__dirname, './src/dbClient.ts'),
        'firebase/auth': path.resolve(__dirname, './src/dbClient.ts'),
        'firebase/storage': path.resolve(__dirname, './src/dbClient.ts'),
      },
    },
    optimizeDeps: {
      include: ['react', 'react-dom'],
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify - file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Runtime database writes are not source changes. Watching these files
      // causes a full-page reload after saves, losing tabs and confirmations.
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        ignored: ['**/local_db.json', '**/local_db.json.tmp'],
      },
    },
    build: {
      chunkSizeWarningLimit: 1000, // Increase warning threshold to 1MB
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('firebase')) {
                return 'vendor-db';
              }
              if (id.includes('recharts') || id.includes('d3')) {
                return 'vendor-charts';
              }
              if (id.includes('lucide-react')) {
                return 'vendor-icons';
              }
              return 'vendor-others';
            }
          }
        }
      }
    }
  };
});
