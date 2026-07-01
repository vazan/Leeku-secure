import express from 'express';
import { getRequest, sql } from '../db.js';

export interface SessionRequest extends express.Request {
  userId?: string;
}

export interface SessionRouteOptions {
  authenticate: express.RequestHandler;
  getCurrentRefreshTokenHash: (req: express.Request) => string | null;
  clearAuth: (res: express.Response) => void;
}

export function createSessionRouter(options: SessionRouteOptions): express.Router {
  const router = express.Router();
  router.use(options.authenticate);

  router.get('/', async (req: SessionRequest, res) => {
    try {
      const currentHash = options.getCurrentRefreshTokenHash(req);
      const request = await getRequest();
      request.input('uid', sql.UniqueIdentifier, req.userId!);
      request.input('currentHash', sql.Char(64), currentHash);
      const result = await request.query<{
        id: string;
        ip_address: string | null;
        user_agent: string | null;
        created_at: Date;
        expires_at: Date;
        is_current: boolean;
      }>(
        `SELECT id,ip_address,user_agent,created_at,expires_at,
                CASE WHEN token_hash=@currentHash THEN TRUE ELSE FALSE END AS is_current
         FROM refresh_tokens
         WHERE user_id=@uid AND revoked_at IS NULL AND expires_at>CURRENT_TIMESTAMP
         ORDER BY created_at DESC`
      );
      res.json({
        sessions: result.recordset.map((session) => ({
          ...session,
          created_at: session.created_at.toISOString(),
          expires_at: session.expires_at.toISOString(),
        })),
      });
    } catch (error) {
      console.error('[GET /api/users/me/sessions]', error);
      res.status(500).json({ error: 'Could not load active sessions.' });
    }
  });

  const revokeSession = async (req: SessionRequest, res: express.Response) => {
    try {
      const currentHash = options.getCurrentRefreshTokenHash(req);
      const request = await getRequest();
      request.input('uid', sql.UniqueIdentifier, req.userId!);
      request.input('id', sql.UniqueIdentifier, req.params.id);
      request.input('currentHash', sql.Char(64), currentHash);
      const result = await request.query<{ revoked_current: boolean }>(
        `UPDATE refresh_tokens
        SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP)
        WHERE id=@id AND user_id=@uid AND revoked_at IS NULL
        RETURNING token_hash=@currentHash AS revoked_current`
      );
      if (!result.rowsAffected[0]) return res.status(404).json({ error: 'Active session not found.' });
      const revokedCurrent = !!result.recordset[0]?.revoked_current;
      if (revokedCurrent) options.clearAuth(res);
      res.json({ success: true, revoked_current: revokedCurrent });
    } catch (error) {
      console.error('[revoke session]', error);
      res.status(500).json({ error: 'Could not revoke session.' });
    }
  };

  router.post('/revoke-others', async (req: SessionRequest, res) => {
    try {
      const currentHash = options.getCurrentRefreshTokenHash(req);
      if (!currentHash) return res.status(400).json({ error: 'Current refresh session not found.' });
      const request = await getRequest();
      request.input('uid', sql.UniqueIdentifier, req.userId!);
      request.input('currentHash', sql.Char(64), currentHash);
      await request.query(
        `UPDATE refresh_tokens
        SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP)
         WHERE user_id=@uid AND token_hash<>@currentHash AND revoked_at IS NULL`
      );
      res.json({ success: true });
    } catch (error) {
      console.error('[POST /api/users/me/sessions/revoke-others]', error);
      res.status(500).json({ error: 'Could not revoke other sessions.' });
    }
  });

  router.post('/current/revoke', async (req: SessionRequest, res) => {
    try {
      const currentHash = options.getCurrentRefreshTokenHash(req);
      if (!currentHash) return res.status(400).json({ error: 'Current refresh session not found.' });
      const request = await getRequest();
      request.input('uid', sql.UniqueIdentifier, req.userId!);
      request.input('currentHash', sql.Char(64), currentHash);
      const result = await request.query(
        `UPDATE refresh_tokens
        SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP)
         WHERE user_id=@uid AND token_hash=@currentHash AND revoked_at IS NULL`
      );
      if (!result.rowsAffected[0]) return res.status(404).json({ error: 'Current refresh session not found.' });
      options.clearAuth(res);
      res.json({ success: true, revoked_current: true });
    } catch (error) {
      console.error('[POST /api/users/me/sessions/current/revoke]', error);
      res.status(500).json({ error: 'Could not revoke current session.' });
    }
  });

  router.delete('/:id', revokeSession);
  router.post('/:id/revoke', revokeSession);

  router.post('/revoke-all', async (req: SessionRequest, res) => {
    try {
      const request = await getRequest();
      request.input('uid', sql.UniqueIdentifier, req.userId!);
      await request.query(
        `UPDATE refresh_tokens
        SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP)
         WHERE user_id=@uid AND revoked_at IS NULL`
      );
      options.clearAuth(res);
      res.json({ success: true });
    } catch (error) {
      console.error('[POST /api/users/me/sessions/revoke-all]', error);
      res.status(500).json({ error: 'Could not revoke all sessions.' });
    }
  });

  return router;
}
