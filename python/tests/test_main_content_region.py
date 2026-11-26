"""First <article> must not hide a longer <main>."""

from __future__ import annotations

from app.ingestion.extract_text import extract_from_html, isolate_main_content_html

TEASER = (
    "Competition Matters How Loyalty Discounts Between Firms Harm Competition "
    "When There Are Network Effects: FTC v. Surescripts Matthew Chesnes "
    "(DAD, BE Antitrust I) and Ted Rosenbaum (Acting BE Director) February 13, 2026"
)
STORY = (
    "Rite Aid banned from using AI facial recognition after the FTC said the "
    "retailer deployed the technology without reasonable safeguards. The order "
    "requires the company to delete the data collected by the system. "
) * 4


def test_ftc_teaser_article_yields_the_main_story() -> None:
    html = f"""
    <html><body>
      <nav>News Events Legal Library</nav>
      <article class="teaser-card">
        <p>{TEASER}</p>
      </article>
      <main>
        <h1>Rite Aid Banned from Using AI Facial Recognition</h1>
        <p>{STORY}</p>
      </main>
      <aside class="sidebar">More from FTC</aside>
      <footer>Stay Connected</footer>
    </body></html>
    """
    text = extract_from_html(html)
    assert "rite aid" in text.lower()
    assert "surescripts" not in text.lower()
    assert "stay connected" not in text.lower()
    assert "legal library" not in text.lower()


def test_article_that_holds_the_story_is_kept() -> None:
    html = f"""
    <html><body>
      <nav>Home News</nav>
      <main>
        <article>
          <h1>Rite Aid order</h1>
          <p>{STORY}</p>
        </article>
      </main>
      <footer>Footer links</footer>
    </body></html>
    """
    scoped = isolate_main_content_html(html)
    assert "Rite Aid banned" in scoped
    assert "Footer links" not in scoped
    text = extract_from_html(html)
    assert "reasonable safeguards" in text.lower()
    assert "home news" not in text.lower()


def test_page_with_only_an_article_is_unchanged() -> None:
    html = f"""
    <html><body>
      <article><p>{STORY}</p></article>
    </body></html>
    """
    text = extract_from_html(html)
    assert "facial recognition" in text.lower()
