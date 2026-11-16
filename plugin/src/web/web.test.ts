import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isPublicAddress, urlRefusal } from "./policy.ts";
import { htmlToText } from "./text.ts";

test("only public http(s) URLs pass", () => {
  assert.equal(urlRefusal("https://example.com/a?b=1"), null);
  assert.equal(urlRefusal("http://93.184.215.14/"), null);
  for (const bad of [
    "file:///etc/passwd", "ftp://example.com", "https://user:pw@example.com", "not a url",
    "http://localhost:8765/mcp", "http://127.0.0.1:8765", "http://[::1]/", "http://10.0.0.1",
    "http://192.168.1.1", "http://172.20.0.1", "http://100.64.0.9", "http://169.254.169.254/latest",
    "https://search.example.internal", "https://device-01.example.ts.net:9443", "http://printer.local", "http://0.0.0.0",
  ]) {
    assert.ok(urlRefusal(bad), bad);
  }
});

test("address classification", () => {
  for (const ok of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) assert.equal(isPublicAddress(ok), true, ok);
  for (const no of ["127.0.0.1", "::1", "10.1.2.3", "100.64.0.1", "100.127.255.255", "fd7a:115c:a1e0::1", "fe80::1", "fc00::1", "::ffff:192.168.0.1", "224.0.0.1", "255.255.255.255", "nonsense"]) {
    assert.equal(isPublicAddress(no), false, no);
  }
});

test("readable text keeps structure and links, drops scripts and markup", () => {
  const html = `<html><head><title>T &amp; t</title><script>evil()</script></head><body>
    <nav>menu</nav><h1>Head</h1><p>Hello&nbsp;<b>world</b> &#8212; <a href="https://x.example/p">link</a></p>
    <ul><li>one</li><li>two</li></ul><style>.a{}</style></body></html>`;
  const { title, text } = htmlToText(html);
  assert.equal(title, "T & t");
  assert.ok(!text.includes("evil") && !text.includes("menu") && !text.includes(".a{}"));
  assert.match(text, /## Head/);
  assert.match(text, /Hello world — link \(https:\/\/x\.example\/p\)/);
  assert.match(text, /- one\n- two/);
  assert.equal(htmlToText("x".repeat(50), 10).truncated, true);
});

import { createServer } from "node:http";
import { safeFetch } from "./fetch.ts";

test("safeFetch never connects to a local address, even through a redirect", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200);
    res.end("secret");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    await assert.rejects(safeFetch(`http://127.0.0.1:${port}/`), /refused/);
    await assert.rejects(safeFetch(`http://localhost:${port}/`), /refused/);
  } finally {
    server.close();
  }
});
