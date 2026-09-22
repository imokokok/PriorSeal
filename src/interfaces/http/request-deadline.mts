import { PriorSealError } from '../../domain/errors.mjs';
import type { IncomingMessage, ServerResponse } from 'node:http';

export function createRequestDeadline(req: IncomingMessage, timeoutMs: number) {
  const controller = new AbortController();
  const abort = (error: Error) => { if (!controller.signal.aborted) controller.abort(error); };
  const onRequestAborted = () => abort(new PriorSealError('REQUEST_ABORTED', 'Request was aborted'));
  const timeout = setTimeout(() => abort(new PriorSealError('REQUEST_TIMEOUT', 'Request timed out')), timeoutMs);
  req.once('aborted', onRequestAborted);

  return {
    signal: controller.signal,
    run<T>(operation: () => T | Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        let settled = false;
        const finish = () => {
          if (settled) return false;
          settled = true;
          controller.signal.removeEventListener('abort', onAbort);
          return true;
        };
        const onAbort = () => { if (finish()) reject(controller.signal.reason ?? new PriorSealError('REQUEST_ABORTED', 'Request was aborted')); };
        controller.signal.addEventListener('abort', onAbort, { once: true });
        if (controller.signal.aborted) return onAbort();
        Promise.resolve().then(() => {
          if (controller.signal.aborted) throw controller.signal.reason ?? new PriorSealError('REQUEST_ABORTED', 'Request was aborted');
          return operation();
        }).then(value => { if (finish()) resolve(value); }, error => { if (finish()) reject(error); });
      });
    },
    closeAfterResponse(res: ServerResponse) {
      res.shouldKeepAlive = false;
      res.once('finish', () => { if (!req.destroyed) req.destroy(); });
    },
    cleanup() {
      clearTimeout(timeout);
      req.removeListener('aborted', onRequestAborted);
    },
  };
}
