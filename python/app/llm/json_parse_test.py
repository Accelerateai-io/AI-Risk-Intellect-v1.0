"""Unit tests for LLM JSON parsing/repair."""

from __future__ import annotations

import json
import unittest

from app.llm.json_parse import normalize_json_text, parse_llm_json


class ParseLlmJsonTests(unittest.TestCase):
    def test_parses_clean_json(self) -> None:
        obj = parse_llm_json('{"risk": {"risk_title": "Test"}, "controls": []}')
        self.assertEqual(obj["risk"]["risk_title"], "Test")

    def test_fixes_trailing_comma_before_brace(self) -> None:
        raw = '{"a": 1, "b": 2,}'
        obj = parse_llm_json(raw)
        self.assertEqual(obj["b"], 2)

    def test_fixes_unescaped_quotes_in_string(self) -> None:
        raw = '{"risk": {"risk_title": "Court said "guilty" today"}}'
        obj = parse_llm_json(raw)
        self.assertIn("guilty", obj["risk"]["risk_title"])

    def test_fixes_single_quoted_keys(self) -> None:
        raw = "{'a': 1, 'b': 2}"
        obj = parse_llm_json(raw)
        self.assertEqual(obj["b"], 2)

    def test_fixes_trailing_comma(self) -> None:
        raw = '{"a": 1, "b": 2,}'
        self.assertEqual(parse_llm_json(raw)["b"], 2)

    def test_fixes_missing_comma_between_keys(self) -> None:
        raw = """{
  "risk": {"risk_title": "AI bias case"}
  "controls": []
}"""
        obj = parse_llm_json(raw)
        self.assertIn("controls", obj)

    def test_fixes_missing_comma_on_same_line(self) -> None:
        raw = '{"a": "one" "b": "two"}'
        obj = parse_llm_json(raw)
        self.assertEqual(obj["b"], "two")

    def test_repair_at_parser_position(self) -> None:
        broken = '{"items": ["x" "y"]}'
        obj = parse_llm_json(broken)
        self.assertEqual(obj["items"], ["x", "y"])

    def test_normalizes_smart_quotes(self) -> None:
        raw = "{\u201crisk\u201d: \u201cvalue\u201d}"
        self.assertEqual(parse_llm_json(raw)["risk"], "value")


class NormalizeJsonTextTests(unittest.TestCase):
    def test_does_not_break_valid_json(self) -> None:
        raw = '{"key": "value", "n": 1}'
        normalized = normalize_json_text(raw)
        self.assertEqual(json.loads(normalized), json.loads(raw))


if __name__ == "__main__":
    unittest.main()
