export function createReadinessHandler(checkDependencies, logger = console) {
  return async (req, res) => {
    try {
      await checkDependencies();
      return res.status(200).json({ ok: true, status: 'ready' });
    } catch {
      logger.warn('Readiness dependency check failed', { requestId: req.requestId });
      return res.status(503).json({ ok: false, status: 'not_ready' });
    }
  };
}
