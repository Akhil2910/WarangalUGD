import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { DATA_DIR, WEB_DIST } from './config.ts';
import { HttpError, registerAuth } from './auth.ts';
import { registerData } from './data.ts';
import { registerFiles } from './files.ts';
import { registerWorks } from './works.ts';
import { registerIssues } from './issues.ts';
import { registerWorkGroups } from './workgroups.ts';
import { registerSite } from './site.ts';
import { registerPrefs } from './prefs.ts';
import { registerGrievances } from './grievances.ts';
import { registerUtilities } from './utilities.ts';
import { registerDashboard } from './dashboard.ts';
import type { Db } from './db.ts';
import { registerCompression } from './compress.ts';
import { loadDefaultProjectItems, registerProject } from './project.ts';
import { registerAdmin } from './admin.ts';
import { registerSchedule } from './schedule.ts';

export async function buildApp(db: Db, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ? { level: 'info' } : false,
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });
  await app.register(cookie);
  // sendFile for /data (Range requests supported); the web build is served at the root.
  await app.register(fastifyStatic, { root: DATA_DIR, serve: false });
  if (existsSync(WEB_DIST)) {
    // wildcard: serve whatever the current build contains (new hashed files after a rebuild);
    // missing files fall through to the not-found handler below.
    // preCompressed: sends the .br / .gz copies made at build time. Hashed files under /assets never change: cache them for a year.
    await app.register(fastifyStatic, {
      root: WEB_DIST, prefix: '/', decorateReply: false, wildcard: true, index: 'index.html', preCompressed: true,
      setHeaders: (res, file) => {
        const f = file.replace(/\\/g, '/');
        if (f.includes('/assets/')) res.header('Cache-Control', 'public, max-age=31536000, immutable');
        else if (f.includes('/fonts/') || f.endsWith('.svg')) res.header('Cache-Control', 'public, max-age=604800');
        else res.header('Cache-Control', 'no-cache');
      },
    });
  }

  // Bad input gives a clear 4xx, never a 500.
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message, code: err.code });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      const message = status === 415 ? 'Unsupported content type.' : status === 413 ? 'The request is too large.' : 'The request is not valid.';
      return reply.status(status).send({ error: message });
    }
    req.log.error(err);
    return reply.status(500).send({ error: 'Something went wrong on the server.' });
  });
  app.setNotFoundHandler((req, reply) => {
    const p = req.url.split('?')[0];
    if (p.startsWith('/api/') || p.startsWith('/data/') || !existsSync(WEB_DIST) || req.method !== 'GET') {
      return reply.status(404).send({ error: 'Not found.' });
    }
    return reply.sendFile('index.html', WEB_DIST); // single-page app routes
  });

  registerCompression(app);
  registerAuth(app, db);
  registerData(app);
  registerFiles(app, db);
  registerWorks(app, db);
  registerIssues(app, db);
  registerWorkGroups(app, db);
  registerSite(app, db);
  registerPrefs(app, db);
  registerGrievances(app, db);
  registerUtilities(app, db);
  registerDashboard(app, db);
  registerProject(app, db);
  registerAdmin(app, db);
  registerSchedule(app, db);
  await loadDefaultProjectItems(db);
  app.get('/api/health', async () => {
    await db.query('SELECT 1');
    return { ok: true, db: db.engine };
  });
  return app;
}
