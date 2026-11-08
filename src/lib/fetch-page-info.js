import { extractArticles } from './extract-articles.js';
import { extractLinks, findMeta, findTitle, normalizeHttpUrl, stripTags } from './html.js';

export async function fetchPageInfo(url, options = {}) {
  const parsedUrl = normalizeHttpUrl(url);
  if (!parsedUrl) throw new Error('Please provide a valid HTTP(S) URL, for example: https://example.com');
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 15000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(parsedUrl.href, {
      headers: { 'user-agent': 'web-info-fetcher/1.0', accept: 'text/html,application/xhtml+xml' },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Request failed for ${parsedUrl.href}: ${response.status} ${response.statusText}`);
    }
    const contentType = response.headers.get('content-type') || '';
    if (contentType && !/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(contentType)) {
      await response.body?.cancel();
      throw new Error(`Non-HTML response for ${parsedUrl.href}: ${contentType}`);
    }
    // The same timeout covers headers AND body consumption.
    const html = await response.text();
    if (!/<(?:!doctype\s+html|html|head|body|main|article|title|a)\b/i.test(html)) {
      throw new Error(`Response does not contain HTML content for ${parsedUrl.href}`);
    }
    const finalUrl = normalizeHttpUrl(response.url || parsedUrl.href);
    const title = findTitle(html);
    if (/^(?:just a moment|attention required|access denied|request blocked|security verification|verify you are human|sign in|log in)(?:\b|[.!…])/i.test(title || '')
      || /(?:id=["']cf-chl-|\/cdn-cgi\/challenge-platform\/|class=["'][^"']*g-recaptcha)/i.test(html)
      || (!title && /^(?:verify you are human|checking your browser|access denied)/i.test(stripTags(html)))) {
      throw new Error(`Blocked or verification-required page for ${finalUrl.href}`);
    }
    return {
      url: finalUrl.href,
      status: response.status,
      title,
      description: findMeta(html, 'description'),
      keywords: findMeta(html, 'keywords'),
      ogTitle: findMeta(html, 'og:title'),
      ogDescription: findMeta(html, 'og:description'),
      ogImage: findMeta(html, 'og:image'),
      links: extractLinks(html, finalUrl.href),
      articles: extractArticles(html, finalUrl.href, options.articleRules)
    };
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Request timed out after ${timeoutMs}ms for ${parsedUrl.href}`, { cause: error });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
