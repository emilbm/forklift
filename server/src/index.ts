import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, migrate } from './db.js';
import { registerRoutes } from './routes.js';
import { createErrorReporter } from './sentry.js';

const here = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 8080);
// Bind to all interfaces: the container needs to be reachable from the LAN,
// and from a Cloudflare tunnel if one is put in front of it.
const HOST = process.env.HOST ?? '0.0.0.0';
const CLIENT_DIR = process.env.FORKLIFT_CLIENT_DIR ?? resolve(here, '../../../../client/dist');
const VERSION = process.env.FORKLIFT_VERSION ?? 'dev';

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  // Behind a Cloudflare tunnel or reverse proxy, trust the forwarded headers so
  // request logs show the real client rather than the proxy.
  trustProxy: true,
});

/**
 * Errors go to GlitchTip when a DSN is set, and nowhere when it isn't. A
 * malformed DSN stops the container here rather than silently dropping the
 * first real error weeks later.
 */
let reporter;
try {
  reporter = createErrorReporter(
    {
      dsn: process.env.SENTRY_DSN ?? '',
      environment: process.env.SENTRY_ENVIRONMENT ?? 'production',
      // CI stamps the image with its commit, which makes a release name for free.
      release: process.env.SENTRY_RELEASE || (VERSION === 'dev' ? undefined : `forklift@${VERSION}`),
      serverName: process.env.SENTRY_SERVER_NAME || undefined,
      maxEventsPerMinute: positiveInt('SENTRY_MAX_EVENTS_PER_MINUTE', 30),
    },
    app.log,
  );
} catch (err) {
  app.log.error((err as Error).message);
  process.exit(1);
}

migrate();
await registerRoutes(app, reporter);

const hasClientBuild = existsSync(join(CLIENT_DIR, 'index.html'));
if (hasClientBuild) {
  // `index` must name the shell: without it a request for "/" resolves to a
  // directory, which the static plugin refuses outright.
  await app.register(fastifyStatic, { root: CLIENT_DIR, index: ['index.html'] });

  // Single-page app: anything that isn't an API route or a real file is a client route.
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) {
      return reply.status(404).send({ error: 'Not found' });
    }
    return reply.sendFile('index.html');
  });
} else {
  app.log.warn(
    { clientDir: CLIENT_DIR },
    'No client build found — serving the API only. Run `npm run build` or use the Vite dev server.',
  );
}

// A rejected promise nobody awaited is exactly the kind of fault that never
// reaches a request handler, so it would otherwise only ever live in the log.
process.on('unhandledRejection', (reason) => {
  app.log.error({ reason }, 'unhandled rejection');
  reporter.capture(reason, { level: 'error', tags: { kind: 'unhandledRejection' } });
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    void app
      .close()
      // Give whatever was in flight a moment to land, so the error that
      // brought the container down is not the one report that goes missing.
      .then(() => reporter.flush())
      .then(() => {
        db.close();
        process.exit(0);
      });
  });
}

try {
  await app.listen({ port: PORT, host: HOST });
} catch (err) {
  app.log.error(err);
  reporter.capture(err, { level: 'fatal' });
  await reporter.flush();
  process.exit(1);
}
