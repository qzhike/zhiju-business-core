import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const fixture = await stat(resolve(root, 'fixture-build.json')).then(
  () => true,
  () => false,
);
if (fixture && process.env.NODE_ENV !== 'development') {
  throw new Error('A development fixture artifact cannot be served in production.');
}
const upstream = new URL(process.env.BFF_URL ?? 'http://127.0.0.1:3101');
if (!['http:', 'https:'].includes(upstream.protocol) || upstream.username || upstream.password) {
  throw new Error('Invalid fixed BFF upstream.');
}
const page =
  /^(?:\/|\/workbench|\/initial-analysis|\/review-workspace|\/projects\/new|\/projects\/[A-Za-z0-9_-]+\/(?:intake|delivery|(?:analysis|startup|executions|tasks)\/[A-Za-z0-9_-]+|(?:files|artifacts)\/[A-Za-z0-9_-]+\/revisions\/[A-Za-z0-9_-]+))$/u;
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; frame-ancestors 'none'; form-action 'self'",
  );
  const path = (req.url ?? '/').split('?')[0];
  if (
    path?.startsWith('/bff/') ||
    path === '/bff' ||
    /^\/api\/markdown-representations\/[0-9a-f-]+\/content$/.test(path ?? '')
  ) {
    const send = upstream.protocol === 'https:' ? httpsRequest : httpRequest;
    const proxy = send(
      new URL(req.url ?? '/', upstream),
      {
        method: req.method,
        headers: { ...req.headers, host: upstream.host },
        timeout: 15_000,
      },
      (response) => {
        // Forward the upstream status and headers (Location, Set-Cookie,
        // Cache-Control, Content-Type, ...): the authentication redirect and the
        // __Host- session cookies must reach the browser unchanged. Only
        // hop-by-hop headers are dropped; the CSP/no-referrer/nosniff headers
        // above stay in place.
        const headers = { ...response.headers };
        for (const hopByHop of ['connection', 'keep-alive', 'transfer-encoding', 'upgrade']) {
          delete headers[hopByHop];
        }
        res.writeHead(response.statusCode ?? 502, headers);
        response.on('aborted', () => res.destroy());
        response.on('error', () => res.destroy());
        response.pipe(res);
      },
    );
    const unavailable = () => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (!res.headersSent) res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ code: 'UI_SERVICE_UNAVAILABLE', message: '服务暂不可用，请稍后重试。' }),
      );
    };
    proxy.on('timeout', () => proxy.destroy());
    proxy.on('error', unavailable);
    res.on('close', () => proxy.destroy());
    req.pipe(proxy);
    return;
  }
  if (!['GET', 'HEAD'].includes(req.method ?? '') || !path) {
    res.writeHead(404).end();
    return;
  }
  const isPage = page.test(path) && req.headers.accept?.includes('text/html');
  const isAsset = /^\/assets\/[A-Za-z0-9_-]+\.(?:js|css)$/u.test(path);
  if (!isPage && !isAsset) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('未找到页面或资源');
    return;
  }
  try {
    const file = resolve(root, isPage ? 'index.html' : path.slice(1));
    const body = await readFile(file);
    if (isAsset) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream');
    res.writeHead(200).end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404).end('未找到页面或资源');
  }
});
server.listen(Number(process.env.PORT ?? 3100), '127.0.0.1');
