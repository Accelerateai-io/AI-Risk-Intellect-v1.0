from app.ingestion.extraction_quality import score_extraction

STORY = (
    "The Federal Trade Commission said Rite Aid must stop using facial recognition "
    "after the retailer deployed the system without reasonable safeguards. "
) * 8


def test_matching_article_scores_high() -> None:
    result = score_extraction(
        url="https://www.ftc.gov/news-events/rite-aid-facial-recognition",
        title="Rite Aid facial recognition order",
        text=STORY,
        html=f"<article><p>{STORY}</p></article>",
    )
    assert result["score"] >= 80
    assert result["parts"]["url_content"] == 20
    assert result["parts"]["title_content"] == 20


def test_missing_title_and_url_cannot_score_high() -> None:
    result = score_extraction(url="", title="", text=STORY, html=f"<p>{STORY}</p>")
    assert result["score"] < 80
    assert result["parts"]["url_content"] == 0
    assert result["parts"]["title_content"] == 0


def test_short_text_is_incomplete() -> None:
    result = score_extraction(
        url="https://www.ftc.gov/news-events/rite-aid-facial-recognition",
        title="Rite Aid facial recognition order",
        text="Rite Aid facial recognition",
        html="<p>Rite Aid facial recognition</p>",
    )
    assert result["parts"]["completeness"] == 0
    assert result["score"] < 80
