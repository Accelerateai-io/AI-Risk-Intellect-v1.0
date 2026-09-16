import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeDisplayTitle,
  decodeHtmlEntities,
} from "./decodeHtmlEntities.js";

test("decodeHtmlEntities decodes named entities", () => {
  assert.equal(
    decodeHtmlEntities("AI &amp; Risk &mdash; What&#39;s Next?"),
    "AI & Risk \u2014 What's Next?",
  );
});

test("decodeHtmlEntities decodes numeric entities", () => {
  assert.equal(decodeHtmlEntities("Quote &#8220;Hello&#8221;"), 'Quote \u201CHello\u201D');
});

test("decodeHtmlEntities decodes hex entities", () => {
  assert.equal(decodeHtmlEntities("Euro &#x20AC;"), "Euro \u20AC");
});

test("decodeHtmlEntities handles double-encoded entities", () => {
  assert.equal(decodeHtmlEntities("Tom &amp;amp; Jerry"), "Tom & Jerry");
});

test("decodeDisplayTitle trims and falls back", () => {
  assert.equal(decodeDisplayTitle("  &amp; Co  "), "& Co");
  assert.equal(decodeDisplayTitle(null, "Untitled"), "Untitled");
  assert.equal(decodeDisplayTitle("   ", "Untitled"), "Untitled");
});
