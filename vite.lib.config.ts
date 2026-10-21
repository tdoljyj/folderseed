import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist-lib',
    emptyOutDir: true,
    copyPublicDir: false,
    minify: false,
    lib: {
      entry: {
        core: fileURLToPath(new URL('./src/core/index.ts', import.meta.url)),
        exports: fileURLToPath(new URL('./src/exports/index.ts', import.meta.url)),
        react: fileURLToPath(new URL('./src/react.ts', import.meta.url)),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
      cssFileName: 'styles',
    },
    rolldownOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'fflate'],
    },
  },
});
