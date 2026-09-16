export function formatBedrockTestError(err: unknown): string {
  const awsErr = err as {
    name?: string;
    message?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };

  const code = awsErr.name ?? awsErr.Code ?? "";
  const detail = awsErr.message?.trim() ?? "";

  if (code === "AccessDeniedException") {
    return "Model is not enabled in your AWS account.";
  }
  if (code === "ValidationException") {
    return detail || "This model is not supported for inference.";
  }
  if (code === "ResourceNotFoundException") {
    return "Model was not found in Bedrock.";
  }
  if (code === "ThrottlingException" || code === "TooManyRequestsException") {
    return "Bedrock rate limit reached. Try again in a moment.";
  }
  if (code === "TimeoutError" || awsErr.name === "AbortError") {
    return "Model test timed out.";
  }
  if (detail) return detail;
  return "Model test failed.";
}
