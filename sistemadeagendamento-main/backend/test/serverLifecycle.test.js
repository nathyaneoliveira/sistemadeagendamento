import assert from 'node:assert/strict';
import test from 'node:test';
import { registerGracefulShutdown } from '../src/serverLifecycle.js';

test('SIGTERM closes the HTTP server and pool exactly once', async () => {
  const handlers = {};
  let closeServer;
  let poolCloseCount = 0;
  const logs = [];
  const processObject = {
    exitCode: 0,
    on(signal, handler) {
      handlers[signal] = handler;
    },
  };

  registerGracefulShutdown({
    server: {
      close(callback) {
        closeServer = callback;
      },
    },
    closePool: async () => {
      poolCloseCount += 1;
    },
    processObject,
    logger: {
      info: (...args) => logs.push(args),
      error: (...args) => logs.push(args),
    },
  });

  handlers.SIGTERM('SIGTERM');
  handlers.SIGINT('SIGINT');
  closeServer();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(poolCloseCount, 1);
  assert.equal(processObject.exitCode, 0);
  assert.equal(logs.some(([message]) => message === 'Database pool closed.'), true);
});

test('pool shutdown failure sets a failing process exit code without exposing error details', async () => {
  const handlers = {};
  const logs = [];
  const processObject = {
    exitCode: 0,
    on(signal, handler) {
      handlers[signal] = handler;
    },
  };

  registerGracefulShutdown({
    server: {
      close(callback) {
        callback();
      },
    },
    closePool: async () => {
      throw new Error('sensitive connection detail');
    },
    processObject,
    logger: {
      info: (...args) => logs.push(args),
      error: (...args) => logs.push(args),
    },
  });

  handlers.SIGTERM('SIGTERM');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(processObject.exitCode, 1);
  assert.equal(logs.some((args) => JSON.stringify(args).includes('sensitive connection detail')), false);
});
