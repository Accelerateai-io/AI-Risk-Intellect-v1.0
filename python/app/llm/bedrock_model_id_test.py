import unittest

from app.llm.bedrock_model_id import resolve_bedrock_invoke_model_id


class BedrockInvokeModelIdTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
