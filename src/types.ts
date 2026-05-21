export interface CrawlOptions {
  maxPages: number;
  delayMs: number;
  respectRobots: boolean;
  useSitemap?: boolean;
}

export interface CrawledPage {
  url: string;
  title: string;
  statusCode: number;
  rawHtml: string;
}

export interface ExtractedPage {
  url: string;
  title: string;
  description: string;
  contentHtml: string;
  assetUrls: AssetUrl[];
}

export interface AssetUrl {
  original: string;
  type: "css" | "js" | "img";
}

export interface AssetManifest {
  map: Record<string, string>;
  failed: string[];
}

export interface GeneratorOptions {
  outputDir: string;
  siteLocation: string;
}
