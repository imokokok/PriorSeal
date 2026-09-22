import { PriorSealError } from '../../domain/errors.mjs';

export function createRequestDeadline(req, timeoutMs) {
  const controller = new AbortController();
  const abort = (error) => { if (!controller.signal.aborted) controller.abort(error); };
  const onRequestAborted = () => abort(new PriorSealError('REQUEST_ABORTED', 'Request was aborted'));
  const timeout = setTimeout(() => abort(new PriorSealError('REQUEST_TIMEOUT', 'Request timed out')), timeoutMs);
  req.once('aborted', onRequestAborted);

  return {
    signal: controller.signal,
    run(operation) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback, value) => {
          if (settled) return;
          settled = true;
          controller.signal.removeEventListener('abort', onAbort);
          callback(value);
        };
        const onAbort = () => finish(reject, controller.signal.reason ?? new PriorSealError('REQUEST_ABORTED', 'Request was aborted'));
        controller.signal.addEventListener('abort', onAbort, { once: true });
        if (controller.signal.aborted) return onAbort();
        Promise.resolve().then(() => {
          if (controller.signal.aborted) throw controller.signal.reason ?? new PriorSealError('REQUEST_ABORTED', 'Request was aborted');
          return operation();
        }).then(value => finish(resolve, value), error => finish(reject, error));
      });
    },
    closeAfterResponse(res) {
      res.shouldKeepAlive = false;
      res.once('finish', () => { if (!req.destroyed) req.destroy(); });
    },
    cleanup() {
      clearTimeout(timeout);
      req.removeListener('aborted', onRequestAborted);
    },
  };
}
