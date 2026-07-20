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
  assert.match(html, /Sensitive file exposure/);
  assert.match(html, /Confidential/);
  assert.match(html, /SERVER FILTERED/);
  assert.match(html, /RESOLVED DEMO SCOPE/);
  assert.match(html, /AUTHORIZED SHAREPOINT INVENTORY/);
  assert.match(html, /Scheduled cache/);
  assert.doesNotMatch(html, /Business visibility|scope-explorer|tree-line/);
  assert.match(html, /FY27-Strategy\.pdf/);
  assert.match(html, /Project Ledger/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("resolved scope proves EVP descendant visibility without rendering a tree", async () => {
  const response = await render();
  const html = await response.text();
  const scopeSummary = html.match(/<section class="resolved-scope"[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.match(scopeSummary, /Corporate Services/);
  assert.match(scopeSummary, /EVP/);
  assert.match(scopeSummary, /6(?:<!-- -->)? Sites/);
  assert.match(scopeSummary, /10<\/dd>/);
  assert.match(scopeSummary, /SERVER RESOLVED/);
  assert.doesNotMatch(html, /scopeQ|scope-breadcrumb|scope-row/);
});

test("SharePoint sites render as a separate searchable flat inventory", async () => {
  const response = await render("/?siteQ=commercial");
  const html = await response.text();
  const siteExplorer = html.match(/<article class="panel site-explorer"[\s\S]*?<\/article>/)?.[0] ?? "";
  assert.match(siteExplorer, /Commercial Leadership Hub/);
  assert.match(siteExplorer, /Awaiting scan/);
  assert.match(siteExplorer, /BUSINESS MAPPING/);
  assert.match(siteExplorer, /LAST SCANNED/);
  assert.match(siteExplorer, /Visibility มาจาก business mapping/);
  assert.doesNotMatch(siteExplorer, /Project Aurora/);
});

test("department persona sees only server-resolved descendant Sites", async () => {
  const response = await render("/?user=anan%40contoso.com&capability=ReportViewer");
  const html = await response.text();
  assert.match(html, /Commercial/);
  assert.match(html, /Commercial Leadership Hub/);
  assert.match(html, /Project Aurora/);
  assert.match(html, /Consumer Markets/);
  assert.doesNotMatch(html, /Project Ledger|Supply Excellence/);
});

test("separate EVP persona cannot see another EVP tree", async () => {
  const response = await render("/?user=orawan%40contoso.com&capability=ReportViewer");
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Digital Ventures/);
  assert.match(html, /Project Orbit/);
  assert.doesNotMatch(html, /Commercial Leadership Hub|Project Aurora|Project Ledger/);
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
