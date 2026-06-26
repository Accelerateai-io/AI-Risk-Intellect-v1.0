import bedrockService from "./bedrock.service.js";

class RiskClassifierService {
  async classify(content) {
    const prompt = `
      Analyze the following content and classify risks into:
      - Technical Risk
      - Operational Risk
      - Business Risk

      Return JSON only.
      
      Content:
      ${content}
    `;

    return await bedrockService.invoke(prompt);
  }
}

export default new RiskClassifierService();