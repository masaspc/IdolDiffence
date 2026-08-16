import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages はプロジェクトページ配信なので /IdolDiffence/ 配下に置かれる。
// base を設定しないとアセットを /assets/... へ取りに行って 404 し、真っ白になる。
// docs/design/05-architecture.md 5.11 を参照。
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/IdolDiffence/' : '/',
  plugins: [react()],
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
}));
