export function resolveApiUrl({ isProduction, apiUrl }) {
  const configuredUrl = apiUrl?.trim();

  if (!configuredUrl && isProduction) {
    throw new Error('VITE_API_URL must be configured for production builds.');
  }

  if (isProduction && configuredUrl === '/api') {
    return configuredUrl;
  }

  const resolvedUrl = configuredUrl || 'http://localhost:4000/api';
  let parsedUrl;

  try {
    parsedUrl = new URL(resolvedUrl);
  } catch {
    throw new Error('VITE_API_URL must be an absolute HTTP(S) URL.');
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const isLoopback = hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname);

  if (
    !['http:', 'https:'].includes(parsedUrl.protocol) ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.search ||
    parsedUrl.hash ||
    (isProduction && (parsedUrl.protocol !== 'https:' || isLoopback))
  ) {
    throw new Error(
      isProduction
        ? 'VITE_API_URL must use HTTPS and must not point to localhost in production.'
        : 'VITE_API_URL must be an absolute HTTP(S) URL without credentials, query, or fragment.'
    );
  }

  return parsedUrl.toString().replace(/\/+$/, '');
}
