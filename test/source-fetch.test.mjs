import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { sourceFetch, BANK_CA_HOSTS } from '../src/lib/source-fetch.mjs';

test('career CA is pinned and confined to bank hostname allowlist', () => {
  const cert = new X509Certificate(readFileSync(new URL('../src/certs/russian-trusted-root.pem', import.meta.url)));
  assert.equal(cert.fingerprint256,'D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31');
  assert.equal(cert.ca,true);
  assert.equal(BANK_CA_HOSTS.has('job.alfabank.ru'),true);
  assert.equal(BANK_CA_HOSTS.has('hh.ru'),false);
  assert.equal(BANK_CA_HOSTS.has('evil.tbank.ru'),false);
});
test('ordinary hosts use native fetch and a bounded request signal', async () => {
  const native = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url.hostname,'example.org');
      assert.ok(init.signal instanceof AbortSignal);
      assert.equal(init.ca,undefined);
      return new Response('ok');
    };
    assert.equal(await (await sourceFetch('https://example.org')).text(),'ok');
  } finally { globalThis.fetch = native; }
});
