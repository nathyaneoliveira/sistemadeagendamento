import { randomUUID } from 'node:crypto';

export function requestIdMiddleware(generateId = randomUUID) {
  return (req, res, next) => {
    req.requestId = generateId();
    res.setHeader('X-Request-ID', req.requestId);
    next();
  };
}
