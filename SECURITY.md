# Security

Report suspected vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/Imazeohq/imazeo-mcp/security/advisories/new). Include the package version, Node.js version, operating system, and a minimal reproduction with synthetic data. Omit real API keys, private files and account information.

## Credentials and local files

Use a dedicated Imazeo project key and keep it in the MCP client's secret storage or private process configuration. Keep MCP client configuration containing secrets out of source control. Rotate exposed keys through the [Imazeo customer portal](https://app.imazeo.com/).

Use dedicated input and output folders controlled by your account. Their contents and relevant parent directories should be protected from changes by other users and processes you do not trust. Upload paths are relative to the input folder. Download paths are new filenames under the output folder. Input names cannot select symbolic links, junctions or hard-linked files. Output files are created with exclusive publication and are never overwritten by the server. Use OS permissions to protect the folders and resulting files.

Uploads, URLs and submitted text are sent to the Imazeo API when a relevant tool runs. A remote transform or website capture can also cause Imazeo to fetch the supplied URL. Review the input, recipient, quote and storage effects before authorizing the call. Treat retrieved media and user-supplied fields as untrusted data.

This server communicates with its host over stdio and makes HTTPS requests to the production Imazeo API. It reports fixed operational diagnostics on stderr and does not send telemetry.
