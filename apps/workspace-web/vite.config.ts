import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ command, mode }) => ({
  plugins: [react(), tailwindcss()],
  define: {
    __DEV_FIXTURE__: JSON.stringify(
      mode === 'fixture' && (command === 'serve' || process.env.NODE_ENV === 'development'),
    ),
  },
  build: {
    sourcemap: false,
    // Shared JSON modules can contain dots in their default chunk names.
    // Keep emitted script names inside the static server's closed asset grammar.
    rolldownOptions: { output: { chunkFileNames: 'assets/chunk-[hash].js' } },
  },
  server: { proxy: { '/bff': 'http://127.0.0.1:3101' } },
}));
