import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const feedSchema = z.object({
  name: z.string().optional(),
  type: z.string().optional(),
  url: z.string().url(),
  enabled: z.boolean().default(true),
});

const sourcesSchema = z.object({
  poll_interval_seconds: z.number().int().positive().default(900),
  feeds: z.array(feedSchema).default([]),
  news: z.array(feedSchema).default([]),
  research: z.array(feedSchema).default([]),
});

export type SourcesConfig = z.infer<typeof sourcesSchema>;

export function loadSourcesConfig(configPath: string): SourcesConfig {
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = parseYaml(raw);
  return sourcesSchema.parse(parsed);
}

export function defaultSourcesConfigPath(): string {
  return path.resolve(process.cwd(), "config", "sources.yaml");
}

/** Collect RSS feed URLs from `feeds`, `news`, and `research` sections (Python-compatible). */
export function gatherRssFeedUrls(config: SourcesConfig): string[] {
  const urls: string[] = [];

  const addFromList = (items: typeof config.feeds) => {
    for (const item of items) {
      if (item.enabled === false) continue;
      const type = (item.type ?? "rss").toLowerCase();
      if (type === "rss" && item.url) {
        urls.push(item.url);
      }
    }
  };

  addFromList(config.feeds);
  addFromList(config.news);
  addFromList(config.research);

  return [...new Set(urls)];
}
