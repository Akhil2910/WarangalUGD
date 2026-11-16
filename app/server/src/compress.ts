/**
 * Smaller downloads: JSON answers from the API and the map's GeoJSON files are sent compressed
 * (brotli or gzip, whichever the browser accepts). Map tiles (.pmtiles) are already compressed and use
 * byte ranges, so they are sent as they are. Built app files are compressed ahead of time (web/scripts/compress.mjs).
 */
import { brotliCompress, constants, gzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { FastifyInstance, FastifyRequest } from 'fastify';

const br = promisify(brotliCompress);
const gz = promisify(gzip);

export function pickEncoding(req: FastifyRequest): 'br' | 'gzip' | null {
  const a = String(req.headers['accept-encoding'] ?? '');
  return /\bbr\b/.test(a) ? 'br' : /\bgzip\b/.test(a) ? 'gzip' : null;
}

export async function compressBuffer(buf: Buffer, enc: 'br' | 'gzip', quality = 5): Promise<Buffer> {
  return enc === 'br'
    ? br(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: quality, [constants.BROTLI_PARAM_SIZE_HINT]: buf.length } })
    : gz(buf, { level: quality >= 9 ? 9 : 6 });
}

export function registerCompression(app: FastifyInstance) {
  app.addHook('onSend', async (req, reply, payload) => {
    if (reply.getHeader('content-encoding')) return payload;
    const type = String(reply.getHeader('content-type') ?? '');
    if (!type.includes('json')) return payload;
    if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) return payload; // streams (files) are left alone
    const buf = typeof payload === 'string' ? Buffer.from(payload) : payload;
    if (buf.length < 1400) return payload;
    const enc = pickEncoding(req);
    if (!enc) return payload;
    const out = await compressBuffer(buf, enc, enc === 'br' ? 4 : 6);
    reply.header('content-encoding', enc);
    reply.header('vary', 'Accept-Encoding');
    reply.removeHeader('content-length');
    return out;
  });
}
