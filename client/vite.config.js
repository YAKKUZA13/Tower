import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig(({ mode }) => ({
  plugins: [vue()],
  define: {
    'import.meta.env.VITE_API_BASE': JSON.stringify(process.env.VITE_API_BASE || 'http://localhost:3000'),
    'import.meta.env.VITE_WS_BASE': JSON.stringify(process.env.VITE_WS_BASE || 'ws://localhost:3000/ws')
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // shared импортируется как runtime (каталоги/типы); резолвим в собранную dist.
      // shared собирается раньше client в корневых dev/build скриптах.
      '@tower/shared': path.resolve(__dirname, '../shared/dist/index.js')
    }
  },
  server: {
    port: 5173,
    strictPort: true,
    open: true
  },
  build: {
    rollupOptions: {
      output: {
        // Babylon.js (~3MB) в отдельный чанк, чтобы login/lobby грузились быстро.
        manualChunks: {
          babylon: ['babylonjs', 'babylonjs-loaders']
        }
      }
    }
  }
}));
