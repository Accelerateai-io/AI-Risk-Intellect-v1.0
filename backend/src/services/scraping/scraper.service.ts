import axios from "axios";
import cheerio from "cheerio";

import { validatePublicUrl } from "../../utils/ssrfProtection.js";

class ScraperService {
  async scrape(url) {
    const parsedUrl = new URL(url);

    await validatePublicUrl(parsedUrl.hostname);

    const response = await axios.get(url, {
      timeout: Number(process.env.REQUEST_TIMEOUT),
      maxContentLength: Number(process.env.MAX_CONTENT_LENGTH),
      headers: {
        "User-Agent": "AI-Risk-Analyzer/1.0",
      },
    });

    const $ = cheerio.load(response.data);

    $("script").remove();
    $("style").remove();

    const text = $("body").text();

    return {
      title: $("title").text(),
      content: text.replace(/\s+/g, " ").trim(),
    };
  }
}

export default new ScraperService();