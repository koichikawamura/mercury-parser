#!/usr/bin/env node

import Mercury from '@jocmp/mercury-parser';
import { decode } from 'html-entities';
import { chromium } from 'playwright';
import { spawn } from 'child_process';

let browserPromise = null;

async function launchOrInstall() {
  try {
    return await chromium.launch({ headless: true });
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
    return await chromium.launch({ headless: true });
  }
}

function getBrowser() {
  if (!browserPromise) {
    browserPromise = launchOrInstall();
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (!browserPromise) return;
  const promise = browserPromise;
  browserPromise = null;
  try {
    const browser = await promise;
    await browser.close();
  } catch (err) {
    console.error(`[mercury-parser] Error closing browser: ${err.message}`);
  }
}

const extractContentToMarkdown = async (url) => {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error(`Invalid URL: ${url}. Only HTTP and HTTPS protocols are supported.`);
  }
  try {
    new URL(url);
  } catch {
    throw new Error(`Invalid URL format: ${url}`);
  }

  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const visitedUrls = new Set();
    const allPages = [];
    let currentUrl = url;

    while (currentUrl && !visitedUrls.has(currentUrl)) {
      console.error(`Fetching page: ${currentUrl}`);
      visitedUrls.add(currentUrl);

      await page.goto(currentUrl, { waitUntil: 'networkidle', timeout: 30000 });
      const html = await page.content();

      const result = await Mercury.parse(currentUrl, { html });
      allPages.push(result);

      currentUrl = await findNextPageLink(page);
    }

    return formatMarkdown(allPages, url);
  } finally {
    await context.close();
  }
};

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
    console.error('Usage: node extractContent.js <url>');
    process.exit(1);
  }
  const url = process.argv[2];
  extractContentToMarkdown(url)
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
