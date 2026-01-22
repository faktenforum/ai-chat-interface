import FirecrawlApp from '@mendable/firecrawl-js';
import { logger } from '../utils/logger.ts';
import { FirecrawlAPIError } from '../utils/errors.ts';

export class FirecrawlClient {
  private client: FirecrawlApp;

  constructor(apiKey: string, apiUrl?: string) {
    const config: { apiKey: string; apiUrl?: string } = { apiKey };
    if (apiUrl) {
      config.apiUrl = apiUrl;
    }
    this.client = new FirecrawlApp(config);
    logger.info({ apiUrl: apiUrl || 'default' }, 'Firecrawl client initialized');
  }

  async scrape(url: string, options?: {
    formats?: string[];
    onlyMainContent?: boolean;
    waitFor?: number;
    timeout?: number;
    mobile?: boolean;
    includeTags?: string[];
    excludeTags?: string[];
    skipTlsVerification?: boolean;
  }) {
    try {
      logger.info({ url, options }, 'Scraping URL');
      const result = await this.client.scrape(url, options);
      return result;
    } catch (error) {
      logger.error({ url, error: error instanceof Error ? error.message : String(error) }, 'Scrape failed');
      throw new FirecrawlAPIError(
        error instanceof Error ? error.message : 'Unknown error during scrape',
        error instanceof Error && 'status' in error ? (error.status as number) : undefined,
      );
    }
  }

  async batchScrape(urls: string[], options?: {
    formats?: string[];
    onlyMainContent?: boolean;
    waitFor?: number;
    timeout?: number;
    mobile?: boolean;
    includeTags?: string[];
    excludeTags?: string[];
    skipTlsVerification?: boolean;
  }) {
    try {
      logger.info({ urlCount: urls.length, options }, 'Starting batch scrape');
      const result = await this.client.batchScrape(urls, options);
      return result;
    } catch (error) {
      logger.error({ urlCount: urls.length, error: error instanceof Error ? error.message : String(error) }, 'Batch scrape failed');
      throw new FirecrawlAPIError(
        error instanceof Error ? error.message : 'Unknown error during batch scrape',
        error instanceof Error && 'status' in error ? (error.status as number) : undefined,
      );
    }
  }

  async map(url: string, options?: {
    search?: string;
    subdomains?: boolean;
    tld?: boolean;
    limit?: number;
  }) {
    try {
      logger.info({ url, options }, 'Mapping website');
      const result = await this.client.map(url, options);
      return result;
    } catch (error) {
      logger.error({ url, error: error instanceof Error ? error.message : String(error) }, 'Map failed');
      throw new FirecrawlAPIError(
        error instanceof Error ? error.message : 'Unknown error during map',
        error instanceof Error && 'status' in error ? (error.status as number) : undefined,
      );
    }
  }

  async crawl(url: string, options?: {
    limit?: number;
    maxDepth?: number;
    allowExternalLinks?: boolean;
    deduplicateSimilarURLs?: boolean;
    scrapeOptions?: {
      formats?: string[];
      onlyMainContent?: boolean;
      waitFor?: number;
      timeout?: number;
      mobile?: boolean;
      includeTags?: string[];
      excludeTags?: string[];
      skipTlsVerification?: boolean;
    };
  }) {
    try {
      logger.info({ url, options }, 'Starting crawl');
      const result = await this.client.crawl(url, options);
      return result;
    } catch (error) {
      logger.error({ url, error: error instanceof Error ? error.message : String(error) }, 'Crawl failed');
      throw new FirecrawlAPIError(
        error instanceof Error ? error.message : 'Unknown error during crawl',
        error instanceof Error && 'status' in error ? (error.status as number) : undefined,
      );
    }
  }

  async search(query: string, options?: {
    limit?: number;
    lang?: string;
    country?: string;
    scrapeOptions?: {
      formats?: string[];
      onlyMainContent?: boolean;
      waitFor?: number;
      timeout?: number;
      mobile?: boolean;
      includeTags?: string[];
      excludeTags?: string[];
      skipTlsVerification?: boolean;
    };
  }) {
    try {
      logger.info({ query, options }, 'Searching web');
      const result = await this.client.search(query, options);
      return result;
    } catch (error) {
      logger.error({ query, error: error instanceof Error ? error.message : String(error) }, 'Search failed');
      throw new FirecrawlAPIError(
        error instanceof Error ? error.message : 'Unknown error during search',
        error instanceof Error && 'status' in error ? (error.status as number) : undefined,
      );
    }
  }

  async extract(urls: string[], options?: {
    prompt?: string;
    systemPrompt?: string;
    schema?: Record<string, unknown>;
    allowExternalLinks?: boolean;
    enableWebSearch?: boolean;
    includeSubdomains?: boolean;
  }) {
    try {
      logger.info({ urlCount: urls.length, options }, 'Extracting structured data');
      const result = await this.client.extract(urls, options);
      return result;
    } catch (error) {
      logger.error({ urlCount: urls.length, error: error instanceof Error ? error.message : String(error) }, 'Extract failed');
      throw new FirecrawlAPIError(
        error instanceof Error ? error.message : 'Unknown error during extract',
        error instanceof Error && 'status' in error ? (error.status as number) : undefined,
      );
    }
  }
}
