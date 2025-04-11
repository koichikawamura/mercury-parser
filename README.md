# mercury-parser

- This is an MCP wrapper to [jocmp/mercury-parser: A maintained fork of Postlight Parser](https://github.com/jocmp/mercury-parser)

## How to use MCP with `npx`

### Claude Desktop

- Add the following entry to `claude_desktop_config.json`

    ```json
    {
        "mcpServers": {
            "mercury-parser": {
                "command": "npx",
                "args": [
                    "@koichikawamura/mercury-parser"
                ]
            }
        }
    }
    ```
