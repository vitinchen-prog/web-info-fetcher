import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { fetchPageInfo } from '../src/lib/fetch-page-info.js';

async function withServer(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('fetch rejects a non-HTML response instead of reporting an empty successful source', async t => {
  const base = await withServer(t, (_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"message":"not a page"}');
  });
  await assert.rejects(fetchPageInfo(base), /non-HTML|HTML content/i);
});

test('fetch rejects a 200-status challenge page transparently', async t => {
  const base = await withServer(t, (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<html><head><title>Just a moment...</title></head><body>Verify you are human<div id="cf-chl-widget">Checking your browser</div></body></html>');
  });
  await assert.rejects(fetchPageInfo(base), /blocked|challenge|verification/i);
});

test('fetch timeout remains active while reading a slow response body', async t => {
  const base = await withServer(t, (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.write('<html><title>Slow source</title>');
    const timer = setTimeout(() => response.end('</html>'), 300);
    response.on('close', () => clearTimeout(timer));
  });
  await assert.rejects(fetchPageInfo(base, { timeoutMs: 50 }), /timeout|timed out|abort/i);
});

test('fetch resolves article links against the final redirected page URL', async t => {
  const base = await withServer(t, (request, response) => {
    if (request.url === '/') {
      response.writeHead(302, { location: '/blog/' });
      response.end();
    } else {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<html><head><title>A real source</title></head><body><article><a href="article">An actual article headline</a><time datetime="2026-11-06">Nov 6, 2026</time></article></body></html>');
    }
  });
  const result = await fetchPageInfo(base, { articleRules: { include: /^\/blog\/article$/ } });
  assert.equal(result.url, `${base}/blog/`);
  assert.equal(result.articles[0].url, `${base}/blog/article`);
});
