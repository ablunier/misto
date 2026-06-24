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

export interface ExtractedPage {
  url: string;
  title: string;
  description: string;
  contentHtml: string;
  assetUrls: AssetUrl[];
  slug?: string;
  /** Absolute action URLs of GET search forms found on the page. */
  searchActions?: string[];
}

export interface AssetUrl {
  original: string;
  type: "css" | "js" | "img" | "font";
}

export interface PaginationGroup {
  /** Canonical URL of page 1 (no page indicator) */
  baseUrl: string;
  /** Output directory path segment, e.g. "es" or "" for root */
  outputDir: string;
  /** All pages in ascending order (page 1 first) */
  pages: ExtractedPage[];
  /** Extracted card/item HTML strings from all pages in order */
  items: string[];
  /** Content HTML before the list container */
  prefix: string;
  /** Content HTML after the pagination nav */
  suffix: string;
  /** Opening tag of the list container, e.g. '<ul class="dreams-list">' */
  listOpenTag: string;
  /** Closing tag name of the list container, e.g. "ul" */
  listCloseTag: string;
  /** Class attribute of the pagination nav, e.g. "pagination-wrapper" */
  navClass: string;
  /** Items per page (count from page 1) */
  size: number;
  title: string;
  description: string;
}

export interface AssetManifest {
  map: Record<string, string>;
  failed: string[];
}

export interface GeneratorOptions {
  outputDir: string;
  siteLocation: string;
}

export interface PageVariant {
  url: string;
  lang?: string;
}

export interface PageGroup {
  canonical: ExtractedPage;
  variants: PageVariant[];
}
