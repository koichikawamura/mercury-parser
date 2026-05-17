#!/usr/bin/env node

import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import extractContentToMarkdown, { closeBrowser } from './extractContent.js';

const buildServer = () => {
  const server = new McpServer({
    name: "Mercury Parser Markdown Converter",
    version: "1.0.0"
  });

  server.registerTool(
    "extract",
    {
      title: "Extract Web Content",
      description: "Extract content from a website and convert it to markdown format",
      inputSchema: {
        url: z.string().describe("URL of the website to extract content from"),
        proxy: z.string().optional().describe(
          "Optional proxy URL for the headless browser, e.g. socks5://localhost:1080 or http://user:pass@host:port"
        )
      }
    },
    async ({ url, proxy }) => {
      try {
        console.error(`Handling extract request for URL: ${url}${proxy ? ` via proxy ${proxy}` : ''}`);
        const markdown = await extractContentToMarkdown(url, { proxy });
        console.error(`Successfully extracted content from: ${url}`);
        return {
          content: [{ type: "text", text: markdown }]
        };
      } catch (error) {
        console.error(`Error in extract: ${error.message}`);
        throw new Error(`Failed to extract content: ${error.message}`);
      }
    }
  );

  server.registerResource(
    "info",
    "resource://postlight/info",
    {
      title: "Mercury Parser Info",
      description: "Information about the Mercury Parser Markdown Converter service",
      mimeType: "application/json"
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify({
            name: "Mercury Parser Markdown Converter",
            description: "MCP service that extracts content from websites and converts it to markdown format",
            version: "1.0.0",
            capabilities: ["extract"]
          })
        }
      ]
    })
  );

  return server;
};

const transportMode = (process.env.MCP_TRANSPORT || 'stdio').toLowerCase();
let httpServer = null;

const startStdio = async () => {
  console.error('MCP Server starting (stdio transport)');
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP Server connected (stdio)');
};

const startHttp = async () => {
  const host = process.env.MCP_HOST || '127.0.0.1';
  const port = parseInt(process.env.MCP_PORT || '3000', 10);
  const path = process.env.MCP_PATH || '/mcp';

  httpServer = http.createServer(async (req, res) => {
    if (!req.url || !req.url.startsWith(path)) {
      res.writeHead(404).end('Not Found');
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Method not allowed.' },
          id: null
        })
      );
      return;
    }

    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      console.error(`HTTP transport error: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null
          })
        );
      }
    }
  });

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  console.error(`MCP Server listening on http://${host}:${port}${path}`);
};

const start = async () => {
  try {
    if (transportMode === 'http') {
      await startHttp();
    } else {
      await startStdio();
    }
  } catch (error) {
    console.error(`Error starting MCP server: ${error.message}`);
    process.exit(1);
  }
};

const shutdown = async (signal) => {
  console.error(`Received ${signal}, shutting down`);
  if (httpServer) {
    await new Promise(resolve => httpServer.close(() => resolve()));
  }
  await closeBrowser();
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
  console.error(`Uncaught exception: ${err.message}`);
  console.error(err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error(`Unhandled rejection: ${reason}`);
});

start();
