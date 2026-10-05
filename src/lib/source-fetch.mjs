import { request } from 'node:https';
import { rootCertificates } from 'node:tls';
import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib';

// Public Russian Trusted Root CA from the official Gosuslugi CDN, downloaded
// over validated HTTPS. Trust is limited to these career hosts, never the OS.
export const BANK_CA_HOSTS = new Set([
  'job.alfabank.ru', 'alfabank.ru', 'www.alfabank.ru',
  'www.tbank.ru', 'tbank.ru', 'education.tbank.ru',
]);
const certificate = readFileSync(new URL('../certs/russian-trusted-root.pem', import.meta.url), 'utf8');
const extraCA = new X509Certificate(certificate);
if (extraCA.fingerprint256 !== 'D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31') throw new Error('Unexpected career CA fingerprint');
if (!extraCA.ca) throw new Error('Career TLS certificate must be a CA');
const ca = [...rootCertificates, certificate];
const MAX_BYTES = 32 * 1024 * 1024;

export async function sourceFetch(input, init = {}) {
  const url = new URL(input);
  const signal = init.signal
    ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)])
    : AbortSignal.timeout(30_000);
  if (url.protocol !== 'https:' || !BANK_CA_HOSTS.has(url.hostname)) {
    return globalThis.fetch(url, { ...init, signal });
  }
  return bankRequest(url, { ...init, signal }, 0);
}

async function bankRequest(url, init, redirects) {
  const headers = Object.fromEntries(new Headers(init.headers));
  const body = init.body;
  if (body != null && typeof body !== 'string' && !Buffer.isBuffer(body) && !(body instanceof URLSearchParams)) {
    throw new TypeError('sourceFetch bank requests accept string, Buffer or URLSearchParams bodies');
  }
  const response = await new Promise((resolve, reject) => {
    const req = request(url, {
      method: init.method || 'GET', headers, signal: init.signal,
      ca, rejectUnauthorized: true,
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BYTES) req.destroy(new Error('Source response exceeds 32 MiB'));
        else chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => {
        try {
          let buffer = Buffer.concat(chunks);
          const encoding = res.headers['content-encoding'];
          const limit = { maxOutputLength: MAX_BYTES };
          if (encoding === 'gzip') buffer = gunzipSync(buffer, limit);
          else if (encoding === 'deflate') buffer = inflateSync(buffer, limit);
          else if (encoding === 'br') buffer = brotliDecompressSync(buffer, limit);
          const resultHeaders = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (value != null && !['content-encoding', 'content-length'].includes(key)) {
              resultHeaders.set(key, Array.isArray(value) ? value.join(', ') : value);
            }
          }
          const status = res.statusCode;
          const result = new Response([204, 205, 304].includes(status) || init.method === 'HEAD' ? null : buffer, {
            status, headers: resultHeaders,
          });
          Object.defineProperty(result, 'url', { value: url.href });
          resolve(result);
        } catch (error) { reject(error); }
      });
    });
    req.on('error', (cause) => reject(new Error(`Source request failed: ${cause.message}`, { cause })));
    if (body != null) req.write(body instanceof URLSearchParams ? body.toString() : body);
    req.end();
  });
  if (![301, 302, 303, 307, 308].includes(response.status) || !response.headers.has('location') || init.redirect === 'manual') return response;
  if (init.redirect === 'error' || redirects >= 5) throw new Error('Source redirect limit reached');
  const next = new URL(response.headers.get('location'), url);
  if (next.protocol !== 'https:') throw new Error('Source attempted insecure redirect');
  const nextInit = { ...init, headers: new Headers(init.headers) };
  if (next.origin !== url.origin) {
    for (const name of ['authorization', 'cookie', 'proxy-authorization']) nextInit.headers.delete(name);
  }
  if (response.status === 303 || ([301, 302].includes(response.status) && (init.method || 'GET').toUpperCase() === 'POST')) {
    nextInit.method = 'GET'; delete nextInit.body;
    nextInit.headers.delete('content-type'); nextInit.headers.delete('content-length');
  }
  // Re-evaluate host on each redirect: the extra root never follows a request
  // to an unrelated host.
  if (!BANK_CA_HOSTS.has(next.hostname)) return globalThis.fetch(next, nextInit);
  return bankRequest(next, nextInit, redirects + 1);
}
