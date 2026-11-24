# Local MCP clients

Use a supported Node.js version. The examples pin the npm release. For a source checkout, use `node` as the command and supply the absolute path to the built `dist/cli.js` as its only argument. If a Windows client cannot resolve `npx`, use `cmd.exe` with arguments `["/d", "/c", "npx", "--yes", "@imazeo/mcp@1.0.2"]`.

Add the optional `IMAZEO_INPUT_DIR` and `IMAZEO_OUTPUT_DIR` variables to the `env` object if you plan to upload or download files. Set each to the absolute path of a dedicated local directory. On Windows, escape backslashes in JSON or use forward slashes. Keep API keys and personal directory locations in private configuration.

## Cursor

Use the `mcpServers` object in `.cursor/mcp.json` or in the global MCP configuration. The Cursor process must have access to the environment variable used below. [Cursor MCP configuration](https://cursor.com/docs/mcp)

~~~json
{
  "mcpServers": {
    "imazeo": {
      "type": "stdio",
      "command": "npx",
      "args": ["--yes", "@imazeo/mcp@1.0.2"],
      "env": {
        "IMAZEO_API_KEY": "${env:IMAZEO_API_KEY}"
      }
    }
  }
}
~~~

## Claude Desktop

Open Settings, then Developer, then Edit Config. Replace the placeholder in your private local configuration with a project key and restart Claude Desktop. Keep the configuration file private because the value is stored there. [Claude Desktop local server guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers)

~~~json
{
  "mcpServers": {
    "imazeo": {
      "command": "npx",
      "args": ["--yes", "@imazeo/mcp@1.0.2"],
      "env": {
        "IMAZEO_API_KEY": "<project-api-key>"
      }
    }
  }
}
~~~

## Claude Code

Use `.mcp.json` for a project-scoped server. Claude Code expands the API key from the environment of the client process. Review the launch command when Claude Code asks you to trust the server. [Claude Code MCP configuration](https://code.claude.com/docs/en/mcp)

~~~json
{
  "mcpServers": {
    "imazeo": {
      "type": "stdio",
      "command": "npx",
      "args": ["--yes", "@imazeo/mcp@1.0.2"],
      "env": {
        "IMAZEO_API_KEY": "${IMAZEO_API_KEY}"
      }
    }
  }
}
~~~

## VS Code

Use the native MCP configuration in `.vscode/mcp.json` or open the user configuration through the Command Palette. The password input keeps the key out of the checked-in configuration. [VS Code MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)

~~~json
{
  "inputs": [
    {
      "id": "imazeo-api-key",
      "type": "promptString",
      "description": "Imazeo project API key",
      "password": true
    }
  ],
  "servers": {
    "imazeo": {
      "type": "stdio",
      "command": "npx",
      "args": ["--yes", "@imazeo/mcp@1.0.2"],
      "env": {
        "IMAZEO_API_KEY": "${input:imazeo-api-key}"
      }
    }
  }
}
~~~

## Check a client connection

Start the server and check that the client lists Imazeo tools. Call `imazeo_project_capabilities` with `{}` to verify the key and project without consuming processing credits. For an end-to-end processing check, use a test project, an explicit credit quote and an approved processing request. Setup examples follow the linked client documentation. The automated suite tests the executable with official MCP clients for both protocol eras.
