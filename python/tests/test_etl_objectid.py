"""Unit tests for MongoDB ObjectId validation."""

from app.etl.objectid import is_valid_object_id, normalize_object_id


def test_valid_object_id():
    value = "507f1f77bcf86cd799439011"
    assert is_valid_object_id(value) is True
    assert normalize_object_id(value) == value


def test_invalid_object_id_length():
    assert is_valid_object_id("507f1f77bcf86cd79943901") is False


def test_missing_object_id():
    assert is_valid_object_id(None) is False
    assert is_valid_object_id("") is False
    assert is_valid_object_id("null") is False


def test_invalid_object_id_characters():
    assert is_valid_object_id("507f1f77bcf86cd79943901g") is False


def test_object_id_wrapped_in_brackets():
    value = 'ObjectId("507f1f77bcf86cd799439011")'
    assert is_valid_object_id(value) is True
    assert normalize_object_id(value) == "507f1f77bcf86cd799439011"


def test_object_id_wrapped_without_quotes():
    value = "ObjectId(507f1f77bcf86cd799439012)"
    assert normalize_object_id(value) == "507f1f77bcf86cd799439012"


def test_object_id_wrapped_single_quotes():
    value = "ObjectId('507f1f77bcf86cd799439013')"
    assert normalize_object_id(value) == "507f1f77bcf86cd799439013"
