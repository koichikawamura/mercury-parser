[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/koichikawamura-mercury-parser-badge.png)](https://mseep.ai/app/koichikawamura-mercury-parser)

# mercury-parser

An MCP wrapper around [jocmp/mercury-parser](https://github.com/jocmp/mercury-parser) (a maintained fork of Postlight Parser). Fetches a web page with a headless Chromium (Playwright) so JavaScript-rendered content is captured, then runs Mercury Parser to extract the article and returns it as Markdown. Follows pagination links automatically.

## Tool

The server exposes a single tool:

### `extract`

| Argument | Type | Required | Description |
|---|---|:-:|---|
| `url` | string | yes | URL of the page to extract |
| `proxy` | string | no | Proxy URL for the headless browser, e.g. `http://host:port`, `socks5://host:port`, `http://user:pass@host:port`. Overrides the `MERCURY_PROXY` env var for this call. |

Returns the article as Markdown (title, author, date, summary, content). On Playwright failure (HTTP/2 protocol errors, navigation timeouts, etc.) falls back to a direct fetch via Mercury Parser so partial content is still returned.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http`. Use `http` for remote/Streamable HTTP transport. |
| `MCP_HOST` | `127.0.0.1` | Bind address when `MCP_TRANSPORT=http`. |
| `MCP_PORT` | `3000` | Bind port when `MCP_TRANSPORT=http`. |
| `MCP_PATH` | `/mcp` | URL path when `MCP_TRANSPORT=http`. |
| `MERCURY_PROXY` | — | Default proxy for the headless browser. Overridden per-call by the `proxy` tool argument. |

## Usage

### Claude Desktop (local stdio)

Add to `claude_desktop_config.json`:

```json
{
    "mcpServers": {
        "mercury-parser": {
            "command": "npx",
            "args": [
                "@koichikawamura/mercury-parser",
                "mercury-parser-mcp"
            ]
        }
    }
}
```

To route the headless browser through a proxy on every call:

```json
{
    "mcpServers": {
        "mercury-parser": {
            "command": "npx",
            "args": [
                "@koichikawamura/mercury-parser",
                "mercury-parser-mcp"
            ],
            "env": {
                "MERCURY_PROXY": "socks5://localhost:1080"
            }
        }
    }
}
```

### Remote MCP (Streamable HTTP)

Run the server over HTTP — useful behind a reverse proxy / Cloudflare Tunnel:

```sh
MCP_TRANSPORT=http \
MCP_HOST=127.0.0.1 \
MCP_PORT=3030 \
MERCURY_PROXY=http://your-proxy:3128 \
npx @koichikawamura/mercury-parser mercury-parser-mcp
```

Clients reach it at `http://<host>:<port>/mcp`. Pair with [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) on the client side, or register directly as a connector in Claude.ai / ChatGPT if the endpoint is gated by an OAuth-aware proxy (e.g. Cloudflare Access).

### CLI (ad-hoc testing)

```sh
node extractContent.js <url> [proxy]
```

## Requirements

- Node.js 18+
- Playwright Chromium (auto-installed on first launch if missing)

## License

MIT — see [LICENSE](LICENSE).
