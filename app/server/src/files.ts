/**
 * Photos and documents. The phone compresses photos (long side about 1,600 px, JPEG) before sending.
 * Upload: POST /api/files with JSON {kind, name, mime, data (base64), gps?, taken_at?}.
 *   Photos: JPEG/PNG/WebP up to 3 MB. Documents: PDF or image up to 10 MB.
 * Download: GET /api/files/:id, signed-in users only. Files are never deleted.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ROLE_RANK } from 'shared';
import { STATE_DIR } from './config.ts';
import { HttpError } from './auth.ts';
import type { Db } from './db.ts';
import { has } from './perms.ts';

export const FILES_DIR = path.join(STATE_DIR, 'files');
const LIMIT = { photo: 3 * 1024 * 1024, document: 10 * 1024 * 1024 };
const MIME = {
  photo: ['image/jpeg', 'image/png', 'image/webp'],
  document: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
};
const SIGNATURES: [string, number[]][] = [
  ['image/jpeg', [0xff, 0xd8, 0xff]],
  ['image/png', [0x89, 0x50, 0x4e, 0x47]],
  ['image/webp', [0x52, 0x49, 0x46, 0x46]],
  ['application/pdf', [0x25, 0x50, 0x44, 0x46]],
];

export const gpsSchema = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), accuracy_m: z.number().min(0).max(100000).optional() }).nullable().optional();

export function registerFiles(app: FastifyInstance, db: Db) {
  mkdirSync(FILES_DIR, { recursive: true });
  const body = z.object({
    kind: z.enum(['photo', 'document']),
    name: z.string().max(200).default(''),
    mime: z.string().max(100),
    data: z.string().min(10),
    gps: gpsSchema,
    taken_at: z.string().datetime().optional(),
  });
  app.post('/api/files', { bodyLimit: 15 * 1024 * 1024 }, async (req) => {
    const u = req.user!;
    if (!has(u, 'files.upload')) throw new HttpError(403, 'Your role cannot add files.');
    const p = body.safeParse(req.body);
    if (!p.success) throw new HttpError(400, 'The file could not be read.');
    return { id: await storeFile(db, p.data, u.id, false) };
  });

  app.get<{ Params: { id: string } }>('/api/files/:id', async (req, reply) => {
    const id = req.params.id;
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, 'Not found.');
    const rows = await db.query<{ mime: string; name: string }>('SELECT mime, name FROM files WHERE id = $1', [id]);
    if (!rows.length || !existsSync(path.join(FILES_DIR, id))) throw new HttpError(404, 'Not found.');
    reply.header('Cache-Control', 'private, max-age=86400');
    reply.header('Content-Disposition', `inline; filename="${rows[0].name.replace(/[^\w.\- ]/g, '_') || id}"`);
    reply.header('X-Content-Type-Options', 'nosniff');
    // Sent as a buffer (files are at most 10 MB) so the stored type is kept; sendFile would guess from the name.
    return reply.type(rows[0].mime).send(readFileSync(path.join(FILES_DIR, id)));
  });
}

/** Check a file and keep it; returns its id. */
export async function storeFile(db: Db, f: { kind: 'photo' | 'document'; name: string; mime: string; data: string; gps?: { lat: number; lon: number } | null; taken_at?: string },
  by: string | null, publicUpload: boolean) {
  if (!MIME[f.kind].includes(f.mime)) throw new HttpError(400, f.kind === 'photo' ? 'Photos must be JPEG, PNG or WebP.' : 'Documents must be PDF or an image.');
  const bytes = Buffer.from(f.data, 'base64');
  if (bytes.length > LIMIT[f.kind]) throw new HttpError(413, `The ${f.kind} is too large (limit ${LIMIT[f.kind] / 1024 / 1024} MB).`);
  const sig = SIGNATURES.find(([m]) => m === f.mime)![1];
  if (!sig.every((b, i) => bytes[i] === b)) throw new HttpError(400, 'The file content does not match its type.');
  const sha = createHash('sha256').update(bytes).digest('hex');
  const rows = await db.query<{ id: string }>(
    `INSERT INTO files (kind, mime, name, size, sha256, gps, taken_at, uploaded_by, public_upload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [f.kind, f.mime, f.name, bytes.length, sha, f.gps ? JSON.stringify(f.gps) : null, f.taken_at ?? null, by, publicUpload],
  );
  writeFileSync(path.join(FILES_DIR, rows[0].id), bytes);
  return rows[0].id;
}

/** Check that every file id exists and is of the expected kind. */
export async function checkFiles(db: Db, ids: string[], kind: 'photo' | 'document') {
  if (!ids.length) return;
  const rows = await db.query<{ id: string }>('SELECT id FROM files WHERE id = ANY($1::uuid[]) AND kind = $2', [ids, kind]);
  if (rows.length !== new Set(ids).size) throw new HttpError(400, `A ${kind} attached to this record was not found. Add it again.`);
}
