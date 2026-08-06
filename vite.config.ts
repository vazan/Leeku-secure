import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('react') || id.includes('react-dom') || id.includes('scheduler')) {
              return 'vendor-react';
            }
            if (id.includes('highlight.js') || id.includes('papaparse')) {
              return 'vendor-preview';
            }
            if (id.includes('lucide-react') || id.includes('radix-ui') || id.includes('react-day-picker')) {
              return 'vendor-ui';
            }
            if (id.includes('motion')) {
              return 'vendor-motion';
            }
            return 'vendor';
          },
        },
      },
    },
    server: {
      allowedHosts: ['localhost', '127.0.0.1', 'leeks.miku.rip'],
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3000',
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyRequest) => {
              proxyRequest.removeHeader('origin');
            });
          },
        },
      },
    },
  };
});
