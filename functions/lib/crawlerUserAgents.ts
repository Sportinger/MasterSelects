// Crawlers and headless checkers count as visitors in product analytics, whose events keep no user agent
// and cannot be filtered later, so they are not stored. Diagnostics keep such reports and separate them
// when reading (diagnosticTraffic.ts). This list stays narrower than that one: what it drops is gone.
const NAMED_CRAWLERS = /googlebot|adsbot|mediapartners-google|google-(?:inspectiontool|read-aloud|extended)|apis-google|bingbot|bingpreview|duckduckbot|yandex(?:bot|images)|baiduspider|applebot|petalbot|bytespider|gptbot|chatgpt-user|oai-searchbot|claudebot|perplexitybot|amazonbot|ahrefsbot|semrushbot|mj12bot|dotbot|shapbot|facebookexternalhit|meta-externalagent|twitterbot|linkedinbot|slackbot|discordbot|telegrambot|headlesschrome|lighthouse|pagespeed|gtmetrix|pingdom/i;
// "compatible; SomeBot/1.0" or a trailing "...spider/2.0"; a bare "bot" substring would also hit phones such as CUBOT.
const DECLARED_CRAWLER = /compatible;[^;)]*(?:bot|crawl|spider)|\b[\w-]*(?:bot|crawler|spider)\/\d/i;

export function isKnownCrawler(userAgent: string | null | undefined): boolean {
  return !!userAgent && (NAMED_CRAWLERS.test(userAgent) || DECLARED_CRAWLER.test(userAgent));
}
