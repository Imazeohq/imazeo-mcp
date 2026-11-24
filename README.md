# Imazeo Media MCP Server

The official Imazeo MCP server connects local AI clients to an Imazeo project over stdio. Process images and PDFs, render Office files and public websites, generate QR codes and barcodes, manage dynamic QR links, and save private outputs. The server is MIT-licensed. Imazeo API usage follows your project's plan, limits, storage quota and credit balance.

[Imazeo](https://imazeo.com/) · [API documentation](https://imazeo.com/docs/) · [Customer portal](https://app.imazeo.com/) · [Imazeo on GitHub](https://github.com/Imazeohq)

## Run locally

Use Node.js 22.19 or later in the 22.x line, 24.x, or 26.x. Get an Imazeo project API key from the [customer portal](https://app.imazeo.com/). After the npm release, configure your MCP client to run the following command.

~~~sh
npx --yes @imazeo/mcp@1.0.0
~~~

For a source checkout, run `npm ci` and `npm run build`. Configure the client to run `node` with the absolute path to `dist/cli.js`.

| Environment variable | Purpose |
| --- | --- |
| `IMAZEO_API_KEY` | Required project API key. Configure as a secret in the client. |
| `IMAZEO_INPUT_DIR` | Optional absolute path to an existing directory. Enables local uploads. |
| `IMAZEO_OUTPUT_DIR` | Optional absolute path to an existing writable directory on a filesystem that supports hard links. Enables local downloads. |

See [client configuration](docs/clients.md) for Cursor, Claude Desktop, Claude Code and VS Code. Call `imazeo_project_capabilities` with `{}` to check authentication without processing media.

## Tools

All names below have the `imazeo_` prefix in MCP.

| Workflow | Tools |
| --- | --- |
| Project and credits | project_capabilities, quote_credits, get_operation, get_operation_result |
| Images | upload_image, list_originals, transform_image |
| PDF | inspect_pdf, render_pdf, merge_pdfs, extract_pdf_pages |
| Static codes | generate_qr, generate_barcode |
| Office and website rendering | submit_conversion, list_conversions, get_conversion, cancel_conversion, save_conversion |
| Private outputs | list_outputs, download_output, save_artifact |
| Dynamic QR | list_dynamic_qr, get_dynamic_qr, create_dynamic_qr, update_dynamic_qr, get_dynamic_qr_analytics |

### Generate a QR code

1. Call `imazeo_quote_credits` with `{"kind":"code.qr","units":1}`.
2. Review the credit amount and confirm with the user before the quote expires.
3. Call `imazeo_generate_qr` with the quote's `id` as `quoteId`, a newly generated UUID v4 as `idempotencyKey`, and `confirm: true`. Use `{"content":"https://example.com","format":"png"}` as `options` and `menu.png` as `output`.
4. Open `menu.png` from the configured output directory. The tool returns file metadata and an operation ID when the API provides one.

### Render a DOCX page

1. Put `report.docx` in the configured input directory. Call `imazeo_project_capabilities` with `{"detail":"conversions"}` to check that DOCX is enabled for the project.
2. Request a one-unit `docx.render` quote and confirm its cost and file upload.
3. Call `imazeo_submit_conversion` with `{"engine":"docx","input":"report.docx","options":{"page":1,"format":"png"}}` as `source`. Supply the reviewed quote ID, a new UUID v4 idempotency key and `confirm: true`.
4. Call `imazeo_get_conversion` with a `lookup` object containing `by: "id"` and the returned job ID as `id`. When the status is completed, pass the ID to `imazeo_download_output` with source `conversion` and a new filename such as `report.png`. Use `imazeo_save_conversion` to retain the result in project storage.

### Processing and recovery

Get a quote for each processing request. Use one unit for static codes, image transformations, PDF inspection, merging and extraction, and each conversion submission. For PDF rendering, quote the number of pages you select, up to 10. The default is page 1. For a remote image transform, set `remote: true` when quoting `image.transform`. Output files for multi-page PDF rendering receive a `-pN` suffix with the original page number.

Keep the idempotency key with the exact request. A network error or MCP cancellation can leave a remote request running. Use `imazeo_get_operation` or `imazeo_get_conversion` with the original key to recover status and retrieve available results. If a quote reports `replayEnabled: false`, synchronous processing may have no durable record. Check project usage before authorizing another attempt. Conversion jobs have their own lookup and cancellation endpoints. A cancellation request can race with completion, so check the returned job.

### Files and privacy

Choose directories you control. Provide relative input paths with forward slashes and a single new filename for each output. The server rejects traversal, links and existing output paths. Upload requests send the file's basename, media type, bytes and operation inputs. Tool results return media metadata and local filenames. Uploads, source URLs, dynamic QR destinations and code payloads are sent to Imazeo for the requested action. See [Security](SECURITY.md) for the trust boundary.

## Limits and troubleshooting

- Project capabilities and the active plan control what you can use. Check current credits and account usage in the [customer portal](https://app.imazeo.com/). The account usage API requires a browser account session.
- The server exposes document rendering to images, selected-page PDF rendering, basic static code styling and aggregate dynamic QR analytics. It uses a single project key per process.
- The local upload limit is 32 MiB per call. Responses from Imazeo are capped at 64 MiB. The server allows two calls in flight and applies a two-minute call deadline. The API or your MCP client can impose lower limits.
- For authentication failures, check the project key and restart the client after updating its configuration. For a 429 response, wait according to the retry guidance. For a conflict, review the quote expiry, request key, job state or revision before retrying.
- If a local write fails after processing, check `operationId` and `remoteAccepted` in the error. Recover retained output with a fresh filename when available. For multi-page results, the error can include files already written.
- Use the client's MCP logs for startup diagnostics. The server emits protocol messages on stdout and diagnostics on stderr.

[Architecture and API contract](docs/architecture.md) · [Contributing](CONTRIBUTING.md) · [Releasing](docs/releasing.md)
