import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

class BedrockService {
  constructor() {
    this.client = new BedrockRuntimeClient({
      region: process.env.AWS_REGION,
    });
  }

  async invoke(prompt) {
    const command = new InvokeModelCommand({
      modelId: process.env.BEDROCK_MODEL_ID,
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
      contentType: "application/json",
      accept: "application/json",
    });

    const response = await this.client.send(command);

    const decoded = new TextDecoder().decode(response.body);

    return JSON.parse(decoded);
  }
}

export default new BedrockService();