#!/usr/bin/env node

import Mercury from '@jocmp/mercury-parser';
import fs from 'fs';
import { decode } from 'html-entities';
import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import e from 'cors';

/**
 * Extracts content from a website and formats it as readable markdown
 * Supports multi-page articles by following pagination links
 * @param {string} url - The URL to parse
 * @returns {Promise<string>} - The formatted markdown content with unescaped characters
 */
const extractContentToMarkdown = async (url) => {
  try {
    // Validate that the URL is a proper web URL
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      throw new Error(`Invalid URL: ${url}. Only HTTP and HTTPS protocols are supported.`);
    }

    // Validate that this is a valid URL
    try {
      new URL(url);
    } catch (error) {
      throw new Error(`Invalid URL format: ${url}`);
    }
    
    // Keep track of visited URLs to avoid loops
    const visitedUrls = new Set();
    // Store all page contents
    const allPages = [];
    
    // Process this URL and any pagination links
    let currentUrl = url;
    let hasMorePages = true;
    
    while (hasMorePages && !visitedUrls.has(currentUrl)) {
      console.error(`Fetching page: ${currentUrl}`);
      visitedUrls.add(currentUrl);
      
      // Parse the current URL using Mercury Parser
      const result = await Mercury.parse(currentUrl);
      allPages.push(result);
      
      // Look for pagination links
      const nextPageUrl = await findNextPageLink(currentUrl);
      if (nextPageUrl && !visitedUrls.has(nextPageUrl)) {
        currentUrl = nextPageUrl;
      } else {
        hasMorePages = false;
      }
    }
    
    return formatMarkdown(allPages, url);
  } catch (error) {
    console.error('Error extracting content:', error);
    return `Error: ${error.message}`;
  }
};

/**
 * Finds the "Next" page link if it exists
 * @param {string} url - The current page URL
 * @returns {Promise<string|null>} - The URL of the next page, or null if none found
 */
async function findNextPageLink(url) {
  try {
    // Validate and normalize the input URL first
    let validUrl;
    try {
      validUrl = new URL(url).href;
    } catch (error) {
      console.error('Invalid URL provided to findNextPageLink:', url);
      return null;
    }
    
    const response = await fetch(validUrl);
    const html = await response.text();
    const dom = new JSDOM(html);
    const document = dom.window.document;
    
    // Check for <base> tag which can affect relative URLs
    const baseTag = document.querySelector('base[href]');
    const baseHref = baseTag ? baseTag.getAttribute('href') : null;
    const baseUrl = baseHref ? new URL(baseHref, validUrl) : new URL(validUrl);
    
    // Look for common pagination patterns
    // 1. Look for a link with NEXT text or a next arrow
    const nextLinks = Array.from(document.querySelectorAll('a')).filter(link => {
      const text = (link.textContent || '').toLowerCase();
      return (
        text.includes('next') || 
        text.includes('次へ') || 
        text.includes('次ページ') ||
        text.includes('→') ||
        text.includes('▶') ||
        (link.getAttribute('rel') === 'next')
      );
    });
    
    // If we found any next links, return the first one's href
    if (nextLinks.length > 0 && nextLinks[0].hasAttribute('href')) {
      const nextUrl = nextLinks[0].getAttribute('href');
      
      // Handle all types of relative URLs by using the URL constructor with the base URL
      try {
        // Use the base URL from <base> tag if available, otherwise use the page URL
        return new URL(nextUrl, baseHref ? baseUrl : validUrl).href;
      } catch (error) {
        console.error('Failed to construct URL from:', nextUrl);
        return null;
      }
    }
    
    // Look for pagination controls that might contain page numbers
    const pageLinks = Array.from(document.querySelectorAll('.pagination a, [aria-label*="pag"] a, nav a')).filter(link => {
      const currentPage = document.querySelector('.pagination .current, [aria-current="page"], .active');
      return currentPage && link !== currentPage && link.hasAttribute('href');
    });
    
    if (pageLinks.length > 0) {
      // Find the link that might be after the current page
      const currentLinks = document.querySelectorAll('.current, .active, [aria-current="page"]');
      if (currentLinks.length > 0) {
        const currentLink = currentLinks[0];
        const pageLinksArray = Array.from(pageLinks);
        
        // Find siblings of current link 
        for (let i = 0; i < pageLinksArray.length; i++) {
          if (
            pageLinksArray[i].previousElementSibling === currentLink ||
            pageLinksArray[i].previousSibling === currentLink
          ) {
            const nextUrl = pageLinksArray[i].getAttribute('href');
            try {
              return new URL(nextUrl, baseHref ? baseUrl : validUrl).href;
            } catch (error) {
              console.error('Failed to construct URL from:', nextUrl);
              return null;
            }
          }
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error finding next page link:', error);
    return null;
  }
}

/**
 * Helper function to unescape HTML entities and special characters
 * @param {string} text - The text to unescape
 * @returns {string} - The unescaped text
 */
function unescapeText(text) {
  if (!text) return '';
  // Use html-entities package to decode HTML entities
  return decode(text)
    // Replace common escaped sequences that might appear in text
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\');
}

/**
 * Format parsed content into markdown
 * @param {Array} pages - Array of parsed page results
 * @param {string} originalUrl - The original URL that was accessed
 * @returns {string} - Formatted markdown content
 */
function formatMarkdown(pages, originalUrl) {
  if (!pages.length) return 'No content found';
  
  // Use the first page for metadata
  const firstPage = pages[0];
  let markdown = `# ${unescapeText(firstPage.title || 'No Title')}\n\n`;
  
  // Add author if available
  if (firstPage.author) {
    markdown += `*Author: ${unescapeText(firstPage.author)}*\n\n`;
  }
  
  // Add date if available
  if (firstPage.date_published) {
    const publishDate = new Date(firstPage.date_published);
    markdown += `*Published: ${publishDate.toLocaleDateString()}*\n\n`;
  }
  
  // Add excerpt if available
  if (firstPage.excerpt) {
    markdown += `## Summary\n${unescapeText(firstPage.excerpt)}\n\n`;
  }
  
  markdown += `## Content\n`;
  
  // Combine the content of all pages
  pages.forEach((page, index) => {
    if (page.content) {
      if (index > 0) {
        markdown += `\n\n### Page ${index + 1}\n\n`;
      }
      markdown += unescapeText(page.content) + '\n\n';
    }
  });
  
  // Add domain and URL reference
  markdown += `---\nSource: [${unescapeText(firstPage.domain)}](${originalUrl})\n`;
  
  return markdown;
}

export default extractContentToMarkdown;

// Example usage if this script is run directly (not imported)
// Only run this code if this file is being executed directly, not when imported as a module
if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.length < 3) {
    console.error('Usage: node extractContent.js <url>');
    process.exit(1);
  }
  const url = process.argv[2];
  
  // Extract content and log it
  extractContentToMarkdown(url).then(markdown => {
    console.log('Content extracted successfully!');
    console.log(markdown);
  });
}
