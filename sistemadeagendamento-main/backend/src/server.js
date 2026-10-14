import { app } from './app.js';
import { env } from './config/env.js';
import { pool } from './db/index.js';
import { registerGracefulShutdown } from './serverLifecycle.js';

const server = app.listen(env.port, () => {
  console.info('Backend listening', { port: env.port, environment: env.nodeEnv });
});

registerGracefulShutdown({
  server,
  closePool: () => pool.end(),
});
