import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = Number(env.PORT || 8787);

  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5174,
      proxy: {
        '/api': `http://127.0.0.1:${apiPort}`
      }
    }
  };
});
