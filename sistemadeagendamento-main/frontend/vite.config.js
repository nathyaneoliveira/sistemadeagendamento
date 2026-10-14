import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolveApiUrl } from './src/apiConfig.js';

export default defineConfig(({ mode }) => {
  const envDir = process.env.FRONTEND_ENV_DIR || process.cwd();
  const env = loadEnv(mode, envDir, 'VITE_');
  if (mode === 'production') {
    resolveApiUrl({ isProduction: true, apiUrl: env.VITE_API_URL });
  }

  return {
    envDir,
    plugins: [react()],
    server: {
      port: 5173,
      host: '0.0.0.0',
    },
  };
});
