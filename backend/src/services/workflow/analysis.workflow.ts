import scraperService from "../scraping/scraper.service.js";

import summaryService from "../ai/summary.service.js";

import riskClassifierService from "../ai/riskClassifier.service.js";

import domainClassifierService from "../ai/domainClassifier.service.js";

class AnalysisWorkflow {
  async execute(url) {
    const scraped = await scraperService.scrape(url);

    const summary = await summaryService.generate(
      scraped.content
    );

    const risks = await riskClassifierService.classify(
      scraped.content
    );

    const domains =
      await domainClassifierService.classify(
        scraped.content
      );

    return {
      url,
      title: scraped.title,
      summary,
      risks,
      domains,
    };
  }
}

export default new AnalysisWorkflow();