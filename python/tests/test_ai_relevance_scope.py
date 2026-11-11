"""AI relevance uses the article, not navigation, tag lists, or other page chrome."""

from __future__ import annotations

from app.ingestion.extract_text import extract_from_html
from app.ingestion.filters import (
    NOT_AI_RELATED_SKIP_MESSAGE,
    excluded_non_ai_topic_skip_reason,
    has_no_ai_signal,
)

# Wording from a blog post whose sidebar tag cloud includes "air travel".
# The pass must come from this body (AIs, vision-language models, fine-tuned),
# not from the tag list and not from a URL or CAPTCHA exception.
VLM_ARTICLE = (
    "Training AIs to Solve CAPTCHAs. Vision-language models (VLMs) can solve "
    "visual puzzles without task-specific training. Our system pairs a "
    "fine-tuned detector with an open-weight VLM."
)

AI_BODY = (
    "Artificial intelligence and large language models solve visual puzzles "
    "without task-specific training."
)


def _skip(html: str, title: str) -> str | None:
    text = extract_from_html(html)
    return excluded_non_ai_topic_skip_reason(title=title, text=text)


def test_ai_article_with_unrelated_air_travel_tag_passes() -> None:
    """Sidebar and in-article tag lists must not count as the article topic."""
    html = f"""
    <html><body>
      <nav><a href="/travel">air travel</a><a href="/sports">football</a></nav>
      <article class="tag-ai category-uncategorized">
        <h1>Training solvers for visual puzzles</h1>
        <p>{AI_BODY}</p>
        <p class="entry-tags">Tags: academic papers, AI, air travel, captchas</p>
      </article>
      <div class="sidebar" id="sidebar-two">
        <h4>Blog Tags</h4>
        <ul class="top-tags">
          <li>academic papers</li><li>air travel</li><li>football</li><li>recipes</li>
        </ul>
      </div>
      <footer>More tags: tourism, celebrity, promo</footer>
    </body></html>
    """
    text = extract_from_html(html)
    assert "air travel" not in text.lower()
    assert "football" not in text.lower()
    assert "large language models" in text.lower()
    assert excluded_non_ai_topic_skip_reason(
        title="Training solvers for visual puzzles",
        text=text,
    ) is None


def test_labeled_tag_list_in_body_text_does_not_reject_ai_article() -> None:
    reason = excluded_non_ai_topic_skip_reason(
        title="Vision systems",
        text=f"{AI_BODY} Tags: air travel, football, recipes",
    )
    assert reason is None
    # The same exclude words still count when they are part of the article.
    prose = excluded_non_ai_topic_skip_reason(
        title="Vision systems",
        text=f"{AI_BODY} The work is about air travel.",
    )
    assert prose == NOT_AI_RELATED_SKIP_MESSAGE


def test_travel_article_with_ai_keywords_in_nav_and_tags_stays_not_ai() -> None:
    html = """
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
    </body></html>
    """
    assert _skip(html, "Best beaches") == NOT_AI_RELATED_SKIP_MESSAGE


def test_ai_and_travel_research_is_scored_from_article_content() -> None:
    html = """
    <html><body>
      <nav>football promo giveaway recipes celebrity basketball</nav>
      <article>
        <h1>Passenger flow study</h1>
        <p>
          Artificial intelligence and large language models and machine learning
          forecast travel demand. The training dataset covers several cities.
        </p>
      </article>
    </body></html>
    """
    text = extract_from_html(html)
    assert "travel" in text.lower()
    assert "football" not in text.lower()
    assert "promo" not in text.lower()
    assert (
        excluded_non_ai_topic_skip_reason(title="Passenger flow study", text=text)
        is None
    )


def test_ai_article_with_sports_and_recipe_tags_is_not_rejected() -> None:
    html = f"""
    <html><body>
      <article>
        <h1>Model notes</h1>
        <p>{AI_BODY}</p>
        <div class="post-tags">football, recipes, cooking, soccer</div>
      </article>
      <aside>Sunday football. A recipe for cooking.</aside>
    </body></html>
    """
    assert _skip(html, "Model notes") is None


def test_genuine_sports_recipe_and_travel_articles_stay_not_ai() -> None:
    sports = """
    <html><body>
      <nav>OpenAI ChatGPT artificial intelligence machine learning</nav>
      <article><h1>Sunday recap</h1>
        <p>The football match and the basketball final drew a crowd.</p>
      </article>
    </body></html>
    """
    recipe = """
    <html><body>
      <aside>artificial intelligence and large language models</aside>
      <article><h1>Weeknight pasta</h1>
        <p>This recipe explains cooking a simple tomato sauce.</p>
      </article>
    </body></html>
    """
    travel = """
    <html><body>
      <div class="sidebar">Tags: artificial intelligence, machine learning</div>
      <article><h1>Coastal diary</h1>
        <p>This travel diary describes a week of tourism.</p>
      </article>
    </body></html>
    """
    assert _skip(sports, "Sunday recap") == NOT_AI_RELATED_SKIP_MESSAGE
    assert _skip(recipe, "Weeknight pasta") == NOT_AI_RELATED_SKIP_MESSAGE
    assert _skip(travel, "Coastal diary") == NOT_AI_RELATED_SKIP_MESSAGE


def test_vlm_article_body_passes_even_with_an_air_travel_tag() -> None:
    text = f"{VLM_ARTICLE} Tags: academic papers, AI, air travel, captchas"
    assert excluded_non_ai_topic_skip_reason(title="Training solvers", text=text) is None
    assert has_no_ai_signal(text, title="Training solvers") is False
    html = f"""
    <html><body>
      <article><p>{VLM_ARTICLE}</p></article>
      <div class="sidebar"><ul class="top-tags"><li>air travel</li><li>football</li></ul></div>
    </body></html>
    """
    extracted = extract_from_html(html)
    assert "air travel" not in extracted.lower()
    assert excluded_non_ai_topic_skip_reason(title="Training solvers", text=extracted) is None
    assert has_no_ai_signal(extracted, title="Training solvers") is False


def test_existing_ai_relevance_rules_still_apply() -> None:
    assert (
        excluded_non_ai_topic_skip_reason(url="https://espn.com/nfl/football")
        == NOT_AI_RELATED_SKIP_MESSAGE
    )
    assert (
        excluded_non_ai_topic_skip_reason(title="Best travel destinations")
        == NOT_AI_RELATED_SKIP_MESSAGE
    )
    assert (
        excluded_non_ai_topic_skip_reason(
            title="OpenAI Back in Court Over ChatGPT",
            text="Travel Food Sports. The artificial intelligence company OpenAI said ChatGPT was used.",
        )
        is None
    )
    assert (
        excluded_non_ai_topic_skip_reason(
            title="Safety note",
            text="Artificial intelligence and large language models need evaluation.",
        )
        is None
    )
