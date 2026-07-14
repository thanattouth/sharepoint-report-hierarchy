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
  assert.match(html, /Business visibility/);
  assert.match(html, /FLAT SHAREPOINT INVENTORY/);
  assert.match(html, /Scheduled cache/);
  assert.doesNotMatch(html, /tree-line/);
  assert.match(html, /FY27-Strategy\.pdf/);
  assert.match(html, /Project Ledger/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("hierarchy navigator renders one level at a time and supports descendant search", async () => {
  const rootResponse = await render();
  const rootHtml = await rootResponse.text();
  const rootExplorer = rootHtml.match(/<article class="panel scope-explorer"[\s\S]*?<\/article>/)?.[0] ?? "";
  assert.match(rootExplorer, /Corporate Services/);
  assert.match(rootExplorer, /Commercial/);
  assert.match(rootExplorer, /Operations &amp; Finance/);
  assert.doesNotMatch(rootExplorer, /Project Aurora|Project Ledger/);

  const searchResponse = await render("/?scopeQ=aurora");
  const searchHtml = await searchResponse.text();
  const searchExplorer = searchHtml.match(/<article class="panel scope-explorer"[\s\S]*?<\/article>/)?.[0] ?? "";
  assert.match(searchExplorer, /Project Aurora/);
  assert.doesNotMatch(searchExplorer, /Project Nova/);
});

test("SharePoint sites render as a separate searchable flat inventory", async () => {
  const response = await render("/?siteQ=commercial");
  const html = await response.text();
  const siteExplorer = html.match(/<article class="panel site-explorer"[\s\S]*?<\/article>/)?.[0] ?? "";
  assert.match(siteExplorer, /Commercial Leadership Hub/);
  assert.match(siteExplorer, /Awaiting scan/);
  assert.match(siteExplorer, /Visibility มาจาก business mapping/);
  assert.doesNotMatch(siteExplorer, /Project Aurora/);
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
