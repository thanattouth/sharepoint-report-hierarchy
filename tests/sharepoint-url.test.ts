import assert from "node:assert/strict";
import test from "node:test";
import { sharePointSiteUrl } from "../src/report/sharepoint-url";

test("SharePoint Site links accept canonical customer-cloud HTTPS hosts", () => {
  assert.equal(
    sharePointSiteUrl("contoso.sharepoint.com", "/sites/finance"),
    "https://contoso.sharepoint.com/sites/finance",
  );
  assert.equal(
    sharePointSiteUrl("CONTOSO.SHAREPOINT.US", "/sites/secure"),
    "https://contoso.sharepoint.us/sites/secure",
  );
});

test("SharePoint Site links reject external hosts and authority-like paths", () => {
  assert.equal(sharePointSiteUrl("sharepoint.com.evil.example", "/sites/finance"), undefined);
  assert.equal(sharePointSiteUrl(".sharepoint.com", "/sites/finance"), undefined);
  assert.equal(sharePointSiteUrl("nested.contoso.sharepoint.com", "/sites/finance"), undefined);
  assert.equal(sharePointSiteUrl("contoso.sharepoint.com", "//evil.example/path"), undefined);
  assert.equal(sharePointSiteUrl("contoso.sharepoint.com", "/sites/finance/../legal"), undefined);
  assert.equal(sharePointSiteUrl("contoso.example.com", "/sites/finance"), undefined);
});
