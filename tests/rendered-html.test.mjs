import assert from "node:assert/strict";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the scoped report prototype", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Sensitivity Report \| SharePoint Governance<\/title>/i);
  assert.match(html, /Secret file exposure/);
  assert.match(html, /SERVER FILTERED/);
  assert.match(html, /FY27-Strategy\.pdf/);
  assert.match(html, /Project Ledger/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("project persona receives only its server-resolved site", async () => {
  const response = await render("/?user=prach%40contoso.com&capability=ReportViewer");
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /FY27-Strategy\.pdf/);
  assert.doesNotMatch(html, /Cashflow-Forecast\.xlsx|Launch-Readiness\.xlsx/);
});

test("no-assignment state does not render inventory rows", async () => {
  const response = await render("/?user=somchai%40contoso.com&capability=ReportViewer");
  const html = await response.text();
  assert.match(html, /NO ACTIVE ASSIGNMENT/);
  assert.doesNotMatch(html, /FY27-Strategy\.pdf|Cashflow-Forecast\.xlsx/);
});
