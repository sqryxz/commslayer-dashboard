import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Commslayer dashboard shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Commslayer Dashboard \| Dr\. Woof<\/title>/i);
  assert.match(html, /agent queue performance/i);
  assert.match(html, /Agent metrics/i);
  assert.match(html, /Manager coaching queue/i);
  assert.match(html, /Coach the tickets that need intervention/i);
  assert.match(html, /Needs coaching/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});
