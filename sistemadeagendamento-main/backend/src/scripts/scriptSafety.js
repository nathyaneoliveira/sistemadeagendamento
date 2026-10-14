export function assertNonProductionScript(nodeEnv, scriptName) {
  if (!['development', 'test'].includes(nodeEnv)) {
    throw new Error(`${scriptName} may only run in development or test environments.`);
  }
}

export function assertLoopbackApiUrl(apiUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(apiUrl);
  } catch {
    throw new Error('API_URL must point to a local development API.');
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const isLoopback = hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname);

  if (parsedUrl.protocol !== 'http:' || !isLoopback || parsedUrl.username || parsedUrl.password) {
    throw new Error('API_URL must point to a local development API.');
  }

  return parsedUrl.toString().replace(/\/+$/, '');
}
