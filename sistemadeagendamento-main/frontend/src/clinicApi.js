import { resolveApiUrl } from './apiConfig.js';

const API_URL = resolveApiUrl({
  isProduction: import.meta.env.PROD,
  apiUrl: import.meta.env.VITE_API_URL,
});

async function getCsrfToken() {
  const response = await fetch(`${API_URL}/auth/csrf`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  const payload = await response.json();
  if (!response.ok || typeof payload?.data?.csrfToken !== 'string') {
    throw new Error('Não foi possível iniciar uma sessão segura.');
  }
  return payload.data.csrfToken;
}

export async function clinicApiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const method = (options.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers.set('X-CSRF-Token', await getCsrfToken());
  }
  if (options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers,
  });
}
