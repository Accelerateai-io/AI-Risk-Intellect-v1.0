import bedrockService from "./bedrock.service.js";

class DomainClassifierService {
  async classify(content) {
    const prompt = `
      Categorize risks into these domains:
      1. Discrimination and Toxicity
      2. Privacy and Security
      3. Misinformation
      4. Malicious Actors
      5. Human-Computer Interaction
      6. Socioeconomic and Environmental
      7. AI System Safety, Failures and Limitations

      Return JSON only.

      Content:
      ${content}
    `;

    return await bedrockService.invoke(prompt);
  }
}

export default new DomainClassifierService();