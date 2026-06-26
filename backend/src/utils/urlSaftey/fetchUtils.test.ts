import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPageFetchSkipReason } from "./fetchUtils.js";

describe("formatPageFetchSkipReason", () => {
  it("normalizes legacy fetch/network messages for the Jobs info panel", () => {
    assert.equal(
      formatPageFetchSkipReason("timeout after 30s"),
      "The site did not respond in time (connection timed out).",
    );
    assert.equal(
      formatPageFetchSkipReason("network error: fetch failed"),
      "Could not reach the site — connection failed (DNS, SSL, firewall, or the server may be down).",
    );
    assert.equal(
      formatPageFetchSkipReason(
        "Site blocked automated access (Cloudflare or bot protection page)",
      ),
      "Site blocked automated access (Cloudflare or bot protection page)",
    );
  });
});
