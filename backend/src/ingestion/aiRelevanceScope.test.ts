import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractFromHtml } from "./extractText.js";
import {
  getExcludedNonAiTopicSkipReason,
  NOT_AI_RELATED_SKIP_MESSAGE,
} from "./filters.js";

const AI_BODY =
  "Artificial intelligence and large language models solve visual puzzles without task-specific training.";

function skip(html: string, title: string): string | null {
  return getExcludedNonAiTopicSkipReason({
    title,
    text: extractFromHtml(html),
  });
}

const VLM_ARTICLE =
  "Training AIs to Solve CAPTCHAs. Vision-language models (VLMs) can solve visual puzzles without task-specific training. Our system pairs a fine-tuned detector with an open-weight VLM.";

describe("AI relevance scope", () => {
  it("passes an AI article whose tag list includes air travel", () => {
    const html = `
      <html><body>
        <nav><a href="/travel">air travel</a><a href="/sports">football</a></nav>
        <article class="tag-ai category-uncategorized">
          <h1>Training solvers for visual puzzles</h1>
          <p>${AI_BODY}</p>
          <p class="entry-tags">Tags: academic papers, AI, air travel, captchas</p>
        </article>
        <div class="sidebar" id="sidebar-two">
          <h4>Blog Tags</h4>
          <ul class="top-tags">
            <li>academic papers</li><li>air travel</li><li>football</li><li>recipes</li>
          </ul>
        </div>
        <footer>More tags: tourism, celebrity, promo</footer>
      </body></html>`;
    const text = extractFromHtml(html);
    assert.equal(text.toLowerCase().includes("air travel"), false);
    assert.equal(text.toLowerCase().includes("football"), false);
    assert.equal(text.toLowerCase().includes("large language models"), true);
    assert.equal(
      getExcludedNonAiTopicSkipReason({
        title: "Training solvers for visual puzzles",
        text,
      }),
      null,
    );
  });

  it("ignores a labeled tag list but still counts exclude words in prose", () => {
    assert.equal(
      getExcludedNonAiTopicSkipReason({
        title: "Vision systems",
        text: `${AI_BODY} Tags: air travel, football, recipes`,
      }),
      null,
    );
    assert.equal(
      getExcludedNonAiTopicSkipReason({
        title: "Vision systems",
        text: `${AI_BODY} The work is about air travel.`,
      }),
      NOT_AI_RELATED_SKIP_MESSAGE,
    );
  });

  it("keeps a travel article NOT_AI when AI keywords are only in nav or tags", () => {
    const html = `
      <html><body>
        <nav>
          <a>Artificial intelligence</a>
          <a>Machine learning</a>
          <a>OpenAI</a>
          <a>ChatGPT</a>
          <a>large language model</a>
        </nav>
        <article>
          <h1>Best beaches</h1>
          <p>This travel guide covers tourism along the coast.</p>
          <p class="entry-tags">Tags: artificial intelligence, machine learning, OpenAI</p>
        </article>
        <footer>football recipes celebrity</footer>
      </body></html>`;
    assert.equal(skip(html, "Best beaches"), NOT_AI_RELATED_SKIP_MESSAGE);
  });

  it("scores an AI-and-travel research article from its body", () => {
    const html = `
      <html><body>
        <nav>football promo giveaway recipes celebrity basketball</nav>
        <article>
          <h1>Passenger flow study</h1>
          <p>
            Artificial intelligence and large language models and machine learning
            forecast travel demand. The training dataset covers several cities.
          </p>
        </article>
      </body></html>`;
    const text = extractFromHtml(html);
    assert.equal(text.toLowerCase().includes("travel"), true);
    assert.equal(text.toLowerCase().includes("football"), false);
    assert.equal(text.toLowerCase().includes("promo"), false);
    assert.equal(
      getExcludedNonAiTopicSkipReason({
        title: "Passenger flow study",
        text,
      }),
      null,
    );
  });

  it("does not reject an AI article because of sports or recipe tags", () => {
    const html = `
      <html><body>
        <article>
          <h1>Model notes</h1>
          <p>${AI_BODY}</p>
          <div class="post-tags">football, recipes, cooking, soccer</div>
        </article>
        <aside>Sunday football. A recipe for cooking.</aside>
      </body></html>`;
    assert.equal(skip(html, "Model notes"), null);
  });

  it("passes a vision-language model article when air travel is only a tag", () => {
    assert.equal(
      getExcludedNonAiTopicSkipReason({
        title: "Training solvers",
        text: `${VLM_ARTICLE} Tags: academic papers, AI, air travel, captchas`,
      }),
      null,
    );
    const extracted = extractFromHtml(`
      <html><body>
        <article><p>${VLM_ARTICLE}</p></article>
        <div class="sidebar"><ul class="top-tags"><li>air travel</li><li>football</li></ul></div>
      </body></html>`);
    assert.equal(extracted.toLowerCase().includes("air travel"), false);
    assert.equal(
      getExcludedNonAiTopicSkipReason({ title: "Training solvers", text: extracted }),
      null,
    );
  });

  it("still rejects genuine sports, recipe, and travel articles", () => {
    const sports = `
      <html><body>
        <nav>OpenAI ChatGPT artificial intelligence machine learning</nav>
        <article><h1>Sunday recap</h1>
          <p>The football match and the basketball final drew a crowd.</p>
        </article>
      </body></html>`;
    const recipe = `
      <html><body>
        <aside>artificial intelligence and large language models</aside>
        <article><h1>Weeknight pasta</h1>
          <p>This recipe explains cooking a simple tomato sauce.</p>
        </article>
      </body></html>`;
    const travel = `
      <html><body>
        <div class="sidebar">Tags: artificial intelligence, machine learning</div>
        <article><h1>Coastal diary</h1>
          <p>This travel diary describes a week of tourism.</p>
        </article>
      </body></html>`;
    assert.equal(skip(sports, "Sunday recap"), NOT_AI_RELATED_SKIP_MESSAGE);
    assert.equal(skip(recipe, "Weeknight pasta"), NOT_AI_RELATED_SKIP_MESSAGE);
    assert.equal(skip(travel, "Coastal diary"), NOT_AI_RELATED_SKIP_MESSAGE);
  });
});
