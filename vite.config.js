import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// 서비스 화면을 메인(index.html)으로 빌드
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
});
