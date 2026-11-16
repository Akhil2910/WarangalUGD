/** Each person's own preferences: the colour, width and line type of each map layer. Saved with the account, so they follow the person to any device. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from './db.ts';
import { HttpError } from './auth.ts';

export const STYLE_KEYS = ['dpr_pipes', 'drawn_pipes', 'work_band', 'dpr_manholes', 'drawn_manholes', 'wards', 'admin', 'sewerzones'] as const;
const style = z.object({
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colour must look like #a855f7.').optional(),
  width: z.number().min(0.2).max(6).optional(),
  dash: z.enum(['solid', 'dashed', 'dotted']).optional(),
  opacity: z.number().min(0.1).max(1).optional(),
});
const prefsBody = z.object({ map_styles: z.partialRecord(z.enum(STYLE_KEYS), style).default({}) });

export function registerPrefs(app: FastifyInstance, db: Db) {
  app.get('/api/me/prefs', async (req) => {
    const r = await db.query<{ prefs: Record<string, unknown> }>('SELECT prefs FROM users WHERE id = $1', [req.user!.id]);
    return { prefs: r[0]?.prefs ?? {} };
  });
  app.post('/api/me/prefs', async (req) => {
    const p = prefsBody.safeParse(req.body);
    if (!p.success) throw new HttpError(400, p.error.issues[0]?.message ?? 'Invalid settings.');
    await db.query(`UPDATE users SET prefs = prefs || $2::jsonb WHERE id = $1`, [req.user!.id, JSON.stringify({ map_styles: p.data.map_styles })]);
    return { ok: true };
  });
}
