#!/usr/bin/env node

import Mercury from '@jocmp/mercury-parser';
import { decode } from 'html-entities';
import { chromium } from 'playwright';
import { spawn } from 'child_process';

const browserPromises = new Map();

function launchOptions(proxy) {
  const opts = { headless: true };
  if (proxy) opts.proxy = { server: proxy };
  return opts;
}

async function launchOrInstall(proxy) {
  try {
    return await chromium.launch(launchOptions(proxy));
  } catch (err) {
    const message = err?.message || '';
    const looksLikeMissingBrowser =
      /Executable doesn't exist/i.test(message) ||
      /please run.*install/i.test(message) ||
      /browserType\.launch/i.test(message);

    if (!looksLikeMissingBrowser) throw err;

    console.error('[mercury-parser] Chromium not found, installing (one-time, ~150MB)...');
    await new Promise((resolve, reject) => {
      const child = spawn('npx', ['--yes', 'playwright', 'install', 'chromium'], {
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      child.on('exit', code =>
        code === 0 ? resolve() : reject(new Error(`playwright install exited with code ${code}`))
      );
      child.on('error', reject);
    });
    return await chromium.launch(launchOptions(proxy));
  }
}

function getBrowser(proxy) {
  const key = proxy || '';
  if (!browserPromises.has(key)) {
    browserPromises.set(key, launchOrInstall(proxy));
  }
  return browserPromises.get(key);
}

export async function closeBrowser() {
  const entries = Array.from(browserPromises.entries());
  browserPromises.clear();
  for (const [, promise] of entries) {
    try {
      const browser = await promise;
      await browser.close();
    } catch (err) {
      console.error(`[mercury-parser] Error closing browser: ${err.message}`);
    }
  }
}

const extractContentToMarkdown = async (url, options = {}) => {
  const proxy = options.proxy || process.env.MERCURY_PROXY || undefined;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error(`Invalid URL: ${url}. Only HTTP and HTTPS protocols are supported.`);
  }
  try {
    new URL(url);
  } catch {
    throw new Error(`Invalid URL format: ${url}`);
  }

  const browser = await getBrowser(proxy);
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    const visitedUrls = new Set();
    const allPages = [];
    let currentUrl = url;

    while (currentUrl && !visitedUrls.has(currentUrl)) {
      console.error(`Fetching page: ${currentUrl}`);
      visitedUrls.add(currentUrl);

      const result = await fetchAndParse(page, currentUrl);
      allPages.push(result);

      currentUrl = await findNextPageLinkSafe(page);
    }

    return formatMarkdown(allPages, url);
  } finally {
    await context.close();
  }
};

async function fetchAndParse(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const html = await page.content();
    return await Mercury.parse(url, { html });
  } catch (err) {
    console.error(`[mercury-parser] Playwright fetch failed for ${url}: ${err.message}. Falling back to direct fetch.`);
    return await Mercury.parse(url);
  }
}

async function findNextPageLinkSafe(page) {
  try {
    if (!page.url() || page.url() === 'about:blank') return null;
    return await findNextPageLink(page);
  } catch {
    return null;
  }
}

async function findNextPageLink(page) {
  return page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a'));
    const nextLink = links.find(link => {
      const text = (link.textContent || '').toLowerCase();
      return (
        text.includes('next') ||
        text.includes('次へ') ||
        text.includes('次ページ') ||
        text.includes('→') ||
        text.includes('▶') ||
        link.getAttribute('rel') === 'next'
      );
    });
    if (nextLink && nextLink.href) return nextLink.href;

    const currentPage = document.querySelector(
      '.pagination .current, [aria-current="page"], .pagination .active'
    );
    if (currentPage) {
      const sibling = currentPage.nextElementSibling;
      if (sibling) {
        if (sibling.tagName === 'A' && sibling.href) return sibling.href;
        const innerA = sibling.querySelector && sibling.querySelector('a[href]');
        if (innerA && innerA.href) return innerA.href;
      }
    }
    return null;
  });
}

function unescapeText(text) {
  if (!text) return '';
  return decode(text)
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\');
}

function formatMarkdown(pages, originalUrl) {
  if (!pages.length) return 'No content found';

  const firstPage = pages[0];
  let markdown = `# ${unescapeText(firstPage.title || 'No Title')}\n\n`;

  if (firstPage.author) {
    markdown += `*Author: ${unescapeText(firstPage.author)}*\n\n`;
  }

  if (firstPage.date_published) {
    const publishDate = new Date(firstPage.date_published);
    markdown += `*Published: ${publishDate.toLocaleDateString()}*\n\n`;
  }

  if (firstPage.excerpt) {
    markdown += `## Summary\n${unescapeText(firstPage.excerpt)}\n\n`;
  }

  markdown += `## Content\n`;

  pages.forEach((page, index) => {
    if (page.content) {
      if (index > 0) {
        markdown += `\n\n### Page ${index + 1}\n\n`;
      }
      markdown += unescapeText(page.content) + '\n\n';
    }
  });

  markdown += `---\nSource: [${unescapeText(firstPage.domain)}](${originalUrl})\n`;

  return markdown;
}

export default extractContentToMarkdown;

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.length < 3) {
    console.error('Usage: node extractContent.js <url> [proxy]');
    process.exit(1);
  }
  const url = process.argv[2];
  const proxy = process.argv[3];
  extractContentToMarkdown(url, { proxy })
    .then(async markdown => {
      console.log(markdown);
      await closeBrowser();
    })
    .catch(async err => {
      console.error(`Error: ${err.message}`);
      await closeBrowser();
      process.exit(1);
    });
}
