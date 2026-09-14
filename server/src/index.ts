import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, migrate } from './db.js';
import { registerRoutes } from './routes.js';

const here = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 8080);
// Bind to all interfaces: the container needs to be reachable from the LAN,
// and from a Cloudflare tunnel if one is put in front of it.
const HOST = process.env.HOST ?? '0.0.0.0';
const CLIENT_DIR = process.env.FORKLIFT_CLIENT_DIR ?? resolve(here, '../../../../client/dist');

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  // Behind a Cloudflare tunnel or reverse proxy, trust the forwarded headers so
  // request logs show the real client rather than the proxy.
  trustProxy: true,
});

migrate();
await registerRoutes(app);

const hasClientBuild = existsSync(join(CLIENT_DIR, 'index.html'));
if (hasClientBuild) {
  await app.register(fastifyStatic, { root: CLIENT_DIR, index: false });

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

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    void app.close().then(() => {
      db.close();
      process.exit(0);
    });
  });
}

try {
  await app.listen({ port: PORT, host: HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
