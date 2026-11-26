"""AI relevance gate: generic words alone are not AI signal.

Asad's 25 Nov feed review found FDA recalls, security advisories and finance
pages getting through the "is this about AI" gate. The cause: any single hit on
AI_INCLUDE kept a page, and AI_INCLUDE held generic words (safety, token,
inference, prompt, dataset) plus a case-insensitive "ml" that matched "10 mL".
"""

import json
from pathlib import Path

import pytest

from app.ingestion.filters import (
    NOT_AI_RELATED_SKIP_MESSAGE,
    classify_ai_related,
    excluded_non_ai_topic_skip_reason,
    has_no_ai_signal,
)

FDA_RECALL = (
    "Acme Pharma is voluntarily recalling one lot of Ondansetron Injection, 2 mg/mL, "
    "10 mL multi-dose vials, to the hospital level due to a potential safety issue: "
    "particulate matter found during inspection. Patients who received the product "
    "should contact their health care provider."
)

SECURITY_ADVISORY = (
    "A vulnerability in the web management interface could allow an unauthenticated, "
    "remote attacker to obtain a valid session token and gain administrative access. "
    "Successful exploitation requires network access. Apply the vendor's update."
)

FINANCE_PAGE = (
    "The Board released a new dataset on household debt. Staff caution against "
    "drawing an inference about default rates from a single quarter. Users should "
    "read the prompt notes at the end of the release."
)

UPPERCASE_UNIT = "Each kit contains a 5 ML syringe and a safety cap."

AI_INCIDENT = (
    "A hospital chatbot gave patients incorrect dosing advice for 10 mL syringes; "
    "the vendor said the safety filters failed."
)

ML_ARTICLE = "The bank's ML model denied loans at a higher rate for older applicants."

ALGORITHMIC = "The CFPB said algorithmic underwriting tools must still explain adverse actions."


def test_fda_recall_with_ml_unit_and_safety_has_no_ai_signal() -> None:
    assert has_no_ai_signal(
        FDA_RECALL,
        title="Acme Pharma Issues Voluntary Nationwide Recall of Ondansetron Injection",
        url="https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/acme",
    ) is True


def test_security_advisory_with_token_has_no_ai_signal() -> None:
    assert has_no_ai_signal(SECURITY_ADVISORY, title="Web interface authentication bypass") is True


def test_finance_page_with_dataset_inference_prompt_has_no_ai_signal() -> None:
    assert has_no_ai_signal(FINANCE_PAGE, title="Household debt release") is True


def test_uppercase_ml_after_a_number_is_a_unit() -> None:
    assert has_no_ai_signal(UPPERCASE_UNIT, title="Kit contents") is True


def test_real_ai_pages_keep_their_signal() -> None:
    assert has_no_ai_signal(AI_INCIDENT, title="Chatbot dosing error") is False
    assert has_no_ai_signal(ML_ARTICLE, title="Loan denials") is False
    assert has_no_ai_signal(ALGORITHMIC, title="Adverse action notices") is False
    assert has_no_ai_signal("OpenAI released a new model.", title="", url="") is False


def test_classify_needs_a_core_term() -> None:
    ok, details = classify_ai_related(SECURITY_ADVISORY + " " + FINANCE_PAGE)
    assert ok is False
    assert details["core_hits"] == 0
    assert details["include_hits"] >= 2  # generic words alone used to pass
    ok, details = classify_ai_related(AI_INCIDENT + " Prompt injection was involved.")
    assert ok is True
    assert details["core_hits"] >= 1


def test_generic_title_word_no_longer_rescues_a_sports_page() -> None:
    text = "Sunday football recap: the home team won after a late safety."
    assert (
        excluded_non_ai_topic_skip_reason(title="Safety first", text=text)
        == NOT_AI_RELATED_SKIP_MESSAGE
    )
    assert excluded_non_ai_topic_skip_reason(title="AI referees", text=text) is None


FIXTURES = json.loads((Path(__file__).parent / "fixtures_ai_signal.json").read_text())


@pytest.mark.parametrize("text", FIXTURES["no_ai_signal"])
def test_shared_fixtures_without_ai_signal(text: str) -> None:
    assert has_no_ai_signal(text) is True, text


@pytest.mark.parametrize("text", FIXTURES["ai_signal"])
def test_shared_fixtures_with_ai_signal(text: str) -> None:
    assert has_no_ai_signal(text) is False, text


@pytest.mark.parametrize("title,url", FIXTURES["ai_signal_from_url_only"])
def test_underscore_url_slug_counts(title: str, url: str) -> None:
    assert has_no_ai_signal("", title=title, url=url) is False
