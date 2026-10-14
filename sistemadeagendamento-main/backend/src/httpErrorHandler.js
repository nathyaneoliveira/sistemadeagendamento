export function createApiErrorHandler({ isProduction, logger = console.error } = {}) {
  return (error, req, res, next) => {
    if (res.headersSent) return next(error);

    if (error?.response && Number.isInteger(error.statusCode)) {
      return res.status(error.statusCode).json(error.response);
    }

    const bodyParserStatus = error?.type === 'entity.parse.failed'
      ? 400
      : error?.type === 'entity.too.large'
        ? 413
        : null;
    const statusCode = bodyParserStatus ||
      (Number.isInteger(error?.statusCode) ? error.statusCode : 500);

    if (req.path.startsWith('/api/public/')) {
      const publicStatus = [400, 413].includes(statusCode) ? statusCode : 500;
      logger('Public API request failed', { requestId: req.requestId, statusCode });
      return res.status(publicStatus).json({
        ok: false,
        message: publicStatus === 400
          ? 'Dados inválidos.'
          : publicStatus === 413
            ? 'Solicitação muito grande.'
            : 'Não foi possível concluir a solicitação.',
        requestId: req.requestId,
      });
    }

    if (isProduction) {
      logger('API request failed', { requestId: req.requestId, statusCode });
    } else {
      logger(error);
    }

    return res.status(statusCode).json({
      ok: false,
      message: isProduction
        ? 'Erro interno do servidor'
        : error.message || 'Erro interno do servidor',
      requestId: req.requestId,
    });
  };
}
