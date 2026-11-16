/**
 * Map data (/data/...) and search, for signed-in users only (the auth hook guards /data and /api).
 * PMTiles are served with HTTP Range from DATA_DIR.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { compressBuffer, pickEncoding } from './compress.ts';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { DATA_DIR } from './config.ts';
import { HttpError } from './auth.ts';

type Entry = [kind: string, label: string, detail: string, lon: number, lat: number];

const packed = new Map<string, { mtime: number; buf: Buffer }>();

export function registerData(app: FastifyInstance) {
  const ALLOWED = /^[a-z0-9_\-]+\.(pmtiles|geojson|json)$/;
  app.get<{ Params: { file: string } }>('/data/:file', async (req, reply) => {
    const file = req.params.file;
    if (!ALLOWED.test(file) || file.includes('_seed')) throw new HttpError(404, 'Not found.');
    const full = path.join(DATA_DIR, file);
    if (!existsSync(full) || !statSync(full).isFile()) throw new HttpError(404, 'This map layer is not available yet.');
    reply.header('Cache-Control', 'private, max-age=3600');
    // GeoJSON / JSON: sent compressed (kept in memory once made); map tiles go as they are, by byte range
    const enc = file.endsWith('.pmtiles') ? null : pickEncoding(req);
    if (enc) {
      const mtime = statSync(full).mtimeMs;
      const key = `${file}|${enc}`;
      let hit = packed.get(key);
      if (!hit || hit.mtime !== mtime) {
        hit = { mtime, buf: await compressBuffer(readFileSync(full), enc, 9) };
        packed.set(key, hit);
      }
      const etag = `"${Math.round(mtime).toString(36)}-${enc}"`;
      reply.header('etag', etag).header('vary', 'Accept-Encoding');
      if (req.headers['if-none-match'] === etag) return reply.status(304).send();
      return reply.header('content-type', file.endsWith('.geojson') ? 'application/geo+json' : 'application/json').header('content-encoding', enc).send(hit.buf);
    }
    return reply.sendFile(file, DATA_DIR);
  });

  // Search index: stretches, manholes, wards, road names, stations.
  let index: Entry[] = [];
  let lowered: string[] = [];
  const indexFile = path.join(DATA_DIR, 'search.json');
  if (existsSync(indexFile)) {
    index = (JSON.parse(readFileSync(indexFile, 'utf8')) as Entry[]).filter((e) => !/stretch/i.test(e[0])); // DPR road stretches are no longer used
    lowered = index.map((e) => `${e[1]} ${e[2]}`.toLowerCase());
  }
  app.get<{ Querystring: { q?: string } }>('/api/search', async (req) => {
    const q = (req.query.q ?? '').trim().toLowerCase();
    if (q.length < 2) return { results: [] };
    if (q.length > 80) throw new HttpError(400, 'Search text is too long.');
    const starts: Entry[] = [];
    const contains: Entry[] = [];
    for (let i = 0; i < index.length && starts.length < 20; i++) {
      const label = index[i][1].toLowerCase();
      if (label.startsWith(q)) starts.push(index[i]);
      else if (contains.length < 20 && lowered[i].includes(q)) contains.push(index[i]);
    }
    const results = [...starts, ...contains].slice(0, 20).map(([kind, label, detail, lon, lat]) => ({ kind, label, detail, lon, lat }));
    return { results };
  });
}
