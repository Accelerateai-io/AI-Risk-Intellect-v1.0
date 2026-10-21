import os
import unittest

from app.env_bootstrap import default_bedrock_model
from app.llm.bedrock_model_id import (
    assert_model_region_compatible,
    bedrock_profile_prefix,
    resolve_bedrock_invoke_model_id,
    strip_us_model_prefix,
    with_us_model_prefix,
)

_REGION_ENV = ("BEDROCK_PROFILE_PREFIX", "AWS_REGION", "AWS_DEFAULT_REGION")


class _EnvIsolationMixin(unittest.TestCase):
    """Snapshot and restore the region/model env vars around each test."""

    _VARS = _REGION_ENV + ("BEDROCK_DEFAULT_MODEL", "BEDROCK_ENFORCE_REGION")

    def setUp(self) -> None:
        self._saved = {k: os.environ.get(k) for k in self._VARS}
        for k in self._VARS:
            os.environ.pop(k, None)

    def tearDown(self) -> None:
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


class BedrockInvokeModelIdTest(_EnvIsolationMixin):
    def test_strips_context_window_suffix_for_invoke(self) -> None:
        self.assertEqual(
            resolve_bedrock_invoke_model_id(
                "us.anthropic.claude-3-sonnet-20240229-v1:0:200k"
            ),
            "us.anthropic.claude-3-sonnet-20240229-v1:0",
        )

    def test_keeps_standard_model_ids(self) -> None:
        self.assertEqual(
            resolve_bedrock_invoke_model_id(
                "anthropic.claude-3-sonnet-20240229-v1:0"
            ),
            "us.anthropic.claude-3-sonnet-20240229-v1:0",
        )


class BedrockProfilePrefixTest(_EnvIsolationMixin):
    """TC-33: inference-profile prefix follows the configured region."""

    def test_defaults_to_us_when_unset(self) -> None:
        self.assertEqual(bedrock_profile_prefix(), "us.")
        self.assertEqual(
            with_us_model_prefix("anthropic.claude-x-v1:0"),
            "us.anthropic.claude-x-v1:0",
        )

    def test_explicit_prefix_env_wins(self) -> None:
        os.environ["BEDROCK_PROFILE_PREFIX"] = "eu"
        os.environ["AWS_REGION"] = "us-east-1"  # explicit prefix overrides region
        self.assertEqual(bedrock_profile_prefix(), "eu.")
        self.assertEqual(
            with_us_model_prefix("anthropic.claude-x-v1:0"),
            "eu.anthropic.claude-x-v1:0",
        )

    def test_explicit_prefix_tolerates_trailing_dot(self) -> None:
        os.environ["BEDROCK_PROFILE_PREFIX"] = "apac."
        self.assertEqual(bedrock_profile_prefix(), "apac.")

    def test_derives_eu_from_region(self) -> None:
        os.environ["AWS_REGION"] = "eu-west-1"
        self.assertEqual(bedrock_profile_prefix(), "eu.")
        self.assertEqual(
            resolve_bedrock_invoke_model_id("anthropic.claude-x-v1:0:200k"),
            "eu.anthropic.claude-x-v1:0",
        )

    def test_derives_apac_from_region(self) -> None:
        os.environ["AWS_REGION"] = "ap-southeast-2"
        self.assertEqual(bedrock_profile_prefix(), "apac.")

    def test_unknown_region_falls_back_to_us(self) -> None:
        os.environ["AWS_REGION"] = "sa-east-1"
        self.assertEqual(bedrock_profile_prefix(), "us.")

    def test_does_not_double_prefix(self) -> None:
        os.environ["AWS_REGION"] = "eu-west-1"
        self.assertEqual(
            with_us_model_prefix("apac.anthropic.claude-x-v1:0"),
            "apac.anthropic.claude-x-v1:0",
        )

    def test_strip_removes_any_profile_prefix(self) -> None:
        self.assertEqual(
            strip_us_model_prefix("eu.anthropic.claude-x-v1:0"),
            "anthropic.claude-x-v1:0",
        )
        self.assertEqual(
            strip_us_model_prefix("apac.anthropic.claude-x-v1:0"),
            "anthropic.claude-x-v1:0",
        )


class BedrockDefaultModelTest(_EnvIsolationMixin):
    """TC-35: the default model is env-driven, not a hard-coded id."""

    def test_reads_env_override(self) -> None:
        os.environ["BEDROCK_DEFAULT_MODEL"] = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
        self.assertEqual(
            default_bedrock_model(),
            "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        )

    def test_unset_keeps_legacy_default(self) -> None:
        # Behaviour is preserved when unset; the kept id is documented in the PR
        # as a question for Asad.
        self.assertEqual(
            default_bedrock_model(),
            "us.anthropic.claude-3-sonnet-20240229-v1:0:200k",
        )

    def test_override_is_not_the_retired_id(self) -> None:
        os.environ["BEDROCK_DEFAULT_MODEL"] = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
        self.assertNotIn("claude-3-sonnet", default_bedrock_model())


class AssertModelRegionCompatibleTest(_EnvIsolationMixin):
    """TC-34: an EU deployment never routes to a US-only model (opt-in)."""

    def test_off_by_default_allows_mismatch(self) -> None:
        # Enforcement disabled: prod EU region with a saved us.* model must not
        # throw, so a deploy never halts extraction.
        os.environ["AWS_REGION"] = "eu-west-1"
        self.assertEqual(
            assert_model_region_compatible("us.deepseek.r1-v1:0"),
            "us.deepseek.r1-v1:0",
        )
        # resolve_* must also stay non-throwing when enforcement is off.
        self.assertEqual(
            resolve_bedrock_invoke_model_id("us.deepseek.r1-v1:0"),
            "us.deepseek.r1-v1:0",
        )

    def test_on_raises_on_mismatch(self) -> None:
        os.environ["BEDROCK_ENFORCE_REGION"] = "true"
        os.environ["AWS_REGION"] = "eu-west-1"
        with self.assertRaises(ValueError) as ctx:
            assert_model_region_compatible("us.deepseek.r1-v1:0")
        msg = str(ctx.exception)
        self.assertIn("eu.", msg)
        self.assertIn("us.deepseek.r1-v1:0", msg)

    def test_on_raises_on_reverse_mismatch(self) -> None:
        os.environ["BEDROCK_ENFORCE_REGION"] = "1"
        os.environ["BEDROCK_PROFILE_PREFIX"] = "us"
        with self.assertRaises(ValueError):
            assert_model_region_compatible("eu.anthropic.claude-x-v1:0")

    def test_on_allows_match(self) -> None:
        os.environ["BEDROCK_ENFORCE_REGION"] = "true"
        os.environ["AWS_REGION"] = "eu-west-1"
        self.assertEqual(
            assert_model_region_compatible("eu.anthropic.claude-x-v1:0"),
            "eu.anthropic.claude-x-v1:0",
        )

    def test_on_allows_unprefixed_model(self) -> None:
        # No explicit region on the model id: nothing to conflict with.
        os.environ["BEDROCK_ENFORCE_REGION"] = "true"
        os.environ["AWS_REGION"] = "eu-west-1"
        self.assertEqual(
            assert_model_region_compatible("anthropic.claude-x-v1:0"),
            "anthropic.claude-x-v1:0",
        )

    def test_on_allows_global_model(self) -> None:
        # 'global.' profiles are multi-region and never conflict.
        os.environ["BEDROCK_ENFORCE_REGION"] = "true"
        os.environ["AWS_REGION"] = "eu-west-1"
        self.assertEqual(
            assert_model_region_compatible("global.anthropic.claude-x-v1:0"),
            "global.anthropic.claude-x-v1:0",
        )


if __name__ == "__main__":
    unittest.main()
