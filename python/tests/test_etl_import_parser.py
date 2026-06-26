"""Unit tests for AIID CSV import parsing."""

from app.etl.import_parser import parse_import_file


def test_parse_csv_skips_invalid_object_ids():
    csv_content = (
        "ObjectId,title,url,text,tags\n"
        ",Missing Title,https://example.com/missing,,\n"
        "invalid-id,Invalid Title,https://example.com/invalid,,\n"
        "507f1f77bcf86cd799439011,Valid Title,https://example.com/valid,Body text,\"ai, risk\"\n"
    ).encode("utf-8")

    result = parse_import_file(csv_content, "reports.csv")

    assert result["totalRows"] == 3
    assert len(result["records"]) == 1
    assert result["records"][0]["id"] == "507f1f77bcf86cd799439011"
    assert result["records"][0]["title"] == "Valid Title"
    assert result["records"][0]["description"] == "Body text"
    assert result["records"][0]["tags"] == ["ai", "risk"]
    assert len(result["skippedRows"]) == 2
    assert result["skippedRows"][0]["reason"] == "ObjectId Missing"
    assert result["skippedRows"][1]["reason"] == "ObjectId Invalid"


def test_parse_csv_with_object_id_wrapper():
    csv_content = (
        "_id,title,url\n"
        'ObjectId("507f1f77bcf86cd799439011"),Valid Title,https://example.com/valid\n'
    ).encode("utf-8")

    result = parse_import_file(csv_content, "reports.csv")

    assert result["totalRows"] == 1
    assert len(result["records"]) == 1
    assert result["records"][0]["id"] == "507f1f77bcf86cd799439011"


def test_parse_csv_multiline_description_field():
    csv_content = (
        "_id,title,url,description\n"
        '"507f1f77bcf86cd799439011","Multiline title","https://example.com/multiline",'
        '"Line one of body\nLine two of body"\n'
        '"507f1f77bcf86cd799439012","Second row","https://example.com/second","Short"\n'
    ).encode("utf-8")

    result = parse_import_file(csv_content, "reports.csv")

    assert result["totalRows"] == 2
    assert len(result["records"]) == 2
    assert "Line one of body" in (result["records"][0]["description"] or "")
    assert "Line two of body" in (result["records"][0]["description"] or "")
    assert result["records"][1]["url"] == "https://example.com/second"


def test_parse_csv_recovers_from_truncated_trailing_record():
    csv_content = (
        "_id,title,url,description\n"
        '"507f1f77bcf86cd799439011","Complete row","https://example.com/complete","Done"\n'
        '"507f1f77bcf86cd799439012","Truncated row","https://example.com/truncated","This quote never closes'
    ).encode("utf-8")

    result = parse_import_file(csv_content, "reports.csv")

    assert result["totalRows"] == 2
    assert len(result["records"]) == 1
    assert result["records"][0]["url"] == "https://example.com/complete"
    assert len(result["skippedRows"]) == 1
    assert "Incomplete CSV record" in result["skippedRows"][0]["reason"]


def test_parse_csv_fails_missing_required_fields():
    csv_content = (
        "ObjectId,title,url\n"
        "507f1f77bcf86cd799439012,,https://example.com/no-title\n"
    ).encode("utf-8")

    result = parse_import_file(csv_content, "reports.csv")

    assert result["totalRows"] == 1
    assert len(result["records"]) == 0
    assert len(result["failedRows"]) == 1
    assert "title" in result["failedRows"][0]["reason"]
