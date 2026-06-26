import bedrockService from "./bedrock.service.js";

class SummaryService {
  async generate(content) {
    const prompt = `
      Summarize this content in 50-100 words:

      ${content}
    `;

    return await bedrockService.invoke(prompt);
  }
}

export default new SummaryService();