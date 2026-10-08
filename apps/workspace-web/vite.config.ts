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
  build: { sourcemap: false },
  server: { proxy: { '/bff': 'http://127.0.0.1:3101' } },
}));
