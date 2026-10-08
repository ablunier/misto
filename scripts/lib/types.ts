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
  slug?: string;
}

export interface AssetUrl {
  original: string;
  type: "css" | "js" | "img" | "font";
}

export interface AssetManifest {
  /** Original absolute URL → local path, e.g. `/assets/css/style.css`. */
  map: Record<string, string>;
  failed: string[];
}

/** One crawled page as listed in the workspace's `pages.json`. */
export interface PageEntry {
  id: string;
  url: string;
  title: string;
  status: number;
  /** Set for query-string URLs, which have no usable path of their own. */
  slug?: string;
  /** Raw HTML file, relative to the workspace. */
  file: string;
}

export interface PagesIndex {
  startUrl: string;
  origin: string;
  pages: PageEntry[];
}
