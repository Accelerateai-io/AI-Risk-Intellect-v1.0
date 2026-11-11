"""B-4: blocked/denied fetches and non-AI pages produce no risk row.

Covers the two golden cases:
  R-24 — a CISA "Access Denied" page (403) is flagged as a fetch failure.
  R-30 — a CISA KEV alert (a real but non-AI page) carries no AI signal, so the
         extractor returns the NoAiRisk marker and no risks row is inserted.
"""

from __future__ import annotations

from app.ingestion.filters import (
    FETCH_FAILED_SKIP_MESSAGE,
    PAYWALL_SKIP_MESSAGE,
    detect_bot_block_page,
    has_no_ai_signal,
)

CISA_ACCESS_DENIED = (
    "<html><head><title>Access Denied</title></head><body>"
    "<h1>Access Denied</h1><p>You don't have permission to access "
    '"http://www.cisa.gov/" on this server.</p></body></html>'
)

# R-30's REAL stored page text: the CISA KEV alert behind the golden-set record
# (docs/remediation/gold_set/sources/R-12498.txt — the same non-AI CISA KEV
# bulletin; R-30's exact article row is not in the local dump). Verbatim so the
# non-AI classifier is exercised against the actual government advisory, not a
# hand-written paraphrase.
CISA_KEV_ALERT = (
    "Alert\n\n"
    "# CISA Adds Four Known Exploited Vulnerabilities to Catalog\n\n"
    "Release Date\n\n"
    "September 09, 2026\n\n"
    "CISA has added four new vulnerabilities to its Known Exploited "
    "Vulnerabilities (KEV) Catalog, based on evidence of active exploitation.\n\n"
    "* CVE-2025-25249 Fortinet Multiple Products Heap-based Buffer Overflow "
    "Vulnerability\n"
    "* CVE-2026-19490 Citrix NetScaler Authentication Bypass Using an Alternate "
    "Path or Channel Vulnerability\n"
    "* CVE-2026-87491 Google Chromium V8 Out of Bounds Write Vulnerability\n"
    "* CVE-2026-20079 Cisco Firewall Management Center Authentication Bypass "
    "Using an Alternate Path or Channel Vulnerability\n\n"
    "These types of vulnerabilities are a frequent attack vector for malicious "
    "cyber actors and pose significant risks to the federal enterprise.\n\n"
    "Binding Operational Directive (BOD) 26-04: Prioritizing Security Updates "
    "Based on Risk establishes vulnerability management requirements for Federal "
    "Civilian Executive Branch (FCEB) agencies. CISA encourages all organizations "
    "to adopt risk-based vulnerability management and prioritize remediation of "
    "KEV Catalog vulnerabilities."
)


def test_r24_access_denied_403_is_flagged():
    assert (
        detect_bot_block_page(CISA_ACCESS_DENIED, http_status=403)
        == FETCH_FAILED_SKIP_MESSAGE
    )


def test_401_and_429_flagged_unconditionally():
    assert detect_bot_block_page("<html>nope</html>", http_status=401) == (
        FETCH_FAILED_SKIP_MESSAGE
    )
    assert detect_bot_block_page("<html>slow</html>", http_status=429) == (
        FETCH_FAILED_SKIP_MESSAGE
    )


def test_paywall_interstitial_with_no_body_is_flagged():
    # A true paywall wall: the marker and almost no article text behind it.
    html = "<html><body><p>Subscribe to continue reading.</p></body></html>"
    assert detect_bot_block_page(html, http_status=200) == PAYWALL_SKIP_MESSAGE


def test_full_article_with_paywall_phrase_in_footer_passes():
    # B-4 review false-positive guard: a full article that merely mentions
    # "to continue reading" / "subscribe" in its footer must NOT be flagged.
    body = "<p>" + ("Real AI governance analysis of model risk. " * 40) + "</p>"
    footer = "<footer>Subscribe to continue reading our weekly newsletter.</footer>"
    html = f"<html><body>{body}{footer}</body></html>"
    assert detect_bot_block_page(html, http_status=200) is None
    # Also when the extractor already supplied the (substantial) body text.
    assert (
        detect_bot_block_page(
            "<html>subscribe to continue reading</html>",
            http_status=200,
            extracted_text="A" * 800,
        )
        is None
    )


def test_normal_200_article_not_flagged():
    html = "<html><body><p>" + ("A" * 800) + "</p></body></html>"
    assert detect_bot_block_page(html, http_status=200) is None


def test_pure_404_left_to_http_status_path():
    assert (
        detect_bot_block_page("<html>A real long body here</html>", http_status=404)
        is None
    )


def test_r30_real_kev_alert_has_no_ai_signal():
    # R-30's real stored page text (the CISA KEV bulletin) carries no AI signal,
    # so the extractor returns NoAiRisk and no risks row is inserted (expected
    # reason code NOT_AI).
    assert (
        has_no_ai_signal(
            CISA_KEV_ALERT,
            title="CISA Adds Four Known Exploited Vulnerabilities to Catalog",
            url="https://www.cisa.gov/news-events/alerts/2026/09/08/cisa-adds-four-known-exploited-vulnerabilities-catalog",
        )
        is True
    )


def test_ai_page_has_signal():
    text = "OpenAI released a new large language model with alignment concerns."
    assert has_no_ai_signal(text, title="OpenAI model", url="https://example.com") is False


def test_empty_text_is_not_treated_as_no_ai():
    # Empty content should not be mislabelled as a confident non-AI page.
    assert has_no_ai_signal("", title="", url="") is False
