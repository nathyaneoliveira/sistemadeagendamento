export function registerGracefulShutdown({
  server,
  closePool,
  processObject = process,
  logger = console,
}) {
  let shuttingDown = false;

  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info('Received shutdown signal; closing HTTP server.', { signal });
    server.close((serverError) => {
      if (serverError) {
        logger.error('HTTP server shutdown failed.');
        processObject.exitCode = 1;
      }

      Promise.resolve()
        .then(closePool)
        .then(() => logger.info('Database pool closed.'))
        .catch(() => {
          logger.error('Database pool shutdown failed.');
          processObject.exitCode = 1;
        });
    });
  };

  processObject.on('SIGTERM', shutdown);
  processObject.on('SIGINT', shutdown);
}
