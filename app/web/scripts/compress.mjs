// After `vite build`: write .br and .gz copies of the text files, so the server can send them compressed
// (about a quarter of the size) without compressing on every request.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const dist = path.resolve(import.meta.dirname, '..', 'dist');
const TEXT = /\.(js|css|html|svg|json|pbf)$/;
let n = 0, before = 0, after = 0;
function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!TEXT.test(f) || f.endsWith('.map')) continue;
    const buf = readFileSync(p);
    if (buf.length < 1024) continue;
    const br = brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
    writeFileSync(`${p}.br`, br);
    writeFileSync(`${p}.gz`, gzipSync(buf, { level: 9 }));
    n++; before += buf.length; after += br.length;
  }
}
walk(dist);
console.log(`compressed ${n} files: ${(before / 1e6).toFixed(2)} MB -> ${(after / 1e6).toFixed(2)} MB (brotli)`);
