import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // three.js 단일 번들이 500kB를 넘으므로 경고 기준만 조정
    chunkSizeWarningLimit: 800,
  },
});
