import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { reserve, commit, release, type Reservation } from '../billing/reservations.js';
import { callUpstream } from '../upstream/client.js';
import { logger } from '../logger.js';

export const paidRouter = Router();

/**
 * Billing policy applied when a consumer disconnects mid-request.
 * If the upstream call already produced a billable response we commit;
 * otherwise we release the reservation so it is not left to expire.
 */
function resolveOnDisconnect(
  reservation: Reservation,
  upstreamStarted: boolean,
): void {
  if (upstreamStarted) {
    commit(reservation).catch((err) => {
      logger.error({ err, reservationId: reservation.id }, 'failed to commit reservation on disconnect');
    });
  } else {
    release(reservation).catch((err) => {
      logger.error({ err, reservationId: reservation.id }, 'failed to release reservation on disconnect');
    });
  }
}

paidRouter.post('/v1/paid', async (req: Request, res: Response) => {
  const requestId = randomUUID();
  const reservation = await reserve(req.body, requestId);

  const controller = new AbortController();
  let upstreamStarted = false;
  let settled = false;

  const onClose = () => {
    if (settled) return;
    settled = true;
    // Abort the in-flight upstream call as soon as the client goes away.
    controller.abort();
    resolveOnDisconnect(reservation, upstreamStarted);
  };

  // `close` fires when the client disconnects before the response completes.
  req.on('close', onClose);

  try {
    upstreamStarted = true;
    const upstream = await callUpstream(req.body, { signal: controller.signal });

    if (settled) {
      // Client already disconnected; reservation was resolved in onClose.
      return;
    }

    settled = true;
    req.off('close', onClose);

    await commit(reservation);
    res.status(upstream.status).json(upstream.body);
  } catch (err) {
    if (settled) {
      // Aborted due to disconnect; reservation already resolved.
      return;
    }
    settled = true;
    req.off('close', onClose);

    await release(reservation).catch((releaseErr) => {
      logger.error({ err: releaseErr, reservationId: reservation.id }, 'failed to release reservation');
    });

    if (controller.signal.aborted) {
      return;
    }

    logger.error({ err, requestId }, 'paid upstream call failed');
    res.status(502).json({ error: 'upstream_error' });
  }
});
