import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 前端开发服务器把 /api 代理到后端，浏览器只与同源打交道。
// 大模型 API Key 只存在于后端进程环境变量中，前端代码与产物里永远拿不到。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
