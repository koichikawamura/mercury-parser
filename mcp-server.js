#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import extractContentToMarkdown from './extractContent.js';

// Create an MCP server
const server = new McpServer({
  name: "Mercury Parser Markdown Converter",
  version: "1.0.0"
});

// Register a tool that extracts content from a URL and returns it as markdown
server.tool(
  "extract", 
  "Extract content from a website and convert it to markdown format",
  {
    url: z.string().describe("URL of the website to extract content from")
  },
  async ({ url }) => {
    try {
      console.error(`Handling extract request for URL: ${url}`);
      
      const markdown = await extractContentToMarkdown(url);
      console.error(`Successfully extracted content from: ${url}`);
      
      return {
        content: [
          {
            type: "text",
            text: markdown
          }
        ]
      };
    } catch (error) {
      console.error(`Error in extract: ${error.message}`);
      throw new Error(`Failed to extract content: ${error.message}`);
    }
  }
);

// Create a resource that provides information about the service
server.resource(
  "info",
  "resource://postlight/info",
  async () => {
    return {
      contents: [
        {
          uri: "resource://postlight/info",
          text: JSON.stringify({
            name: "Mercury Parser Markdown Converter",
            description: "MCP service that extracts content from websites and converts it to markdown format",
            version: "1.0.0",
            capabilities: ["extract"]
          })
        }
      ]
    };
  }
);

// Start the server using the stdio transport
const start = async () => {
  try {
    console.error('MCP Server starting (using StdioServerTransport)');
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('MCP Server successfully connected to transport');
  } catch (error) {
    console.error(`Error starting MCP server: ${error.message}`);
    process.exit(1);
  }
};

// Handle process termination
process.on('SIGINT', () => {
  console.error('Received SIGINT, shutting down');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error(`Uncaught exception: ${err.message}`);
  console.error(err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error(`Unhandled rejection: ${reason}`);
});

// Start the MCP server
start();