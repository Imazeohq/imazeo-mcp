# Architecture and API contract

The executable starts the official MCP TypeScript SDK's stdio server. Its factory accepts both 2025-era MCP initialization and 2026-07-28 discovery. Tool inputs use explicit JSON schemas and a matching runtime validator. Results provide structured content and a text representation for clients that display text only. Tools cover project workflows and retrieve permission-checked data on demand.

An adapter around the official `@imazeo/sdk` resolves the current project through `GET /v1/api-key/context`. The adapter pins the production origin, rejects redirects, bounds response reads, honors cancellation and captures request IDs, operation IDs and rate limit advice. Each MCP call can make a project-context request if the project ID has yet to be resolved, followed by the requested API action. A failed resolution can be attempted again on the next user call.

## Production baseline

The contract follows Imazeo API 1.0.0 and the [published developer OpenAPI](https://imazeo.com/openapi/imazeo-developer.json). DOCX creation uses `POST /v1/projects/{projectId}/conversions`. XLSX, PPTX and website creation use their explicit engine suffixes on the same base route. The server reports remote job state and uses caller-directed status checks. Feature availability depends on project entitlements.

Processing uses an expiring credit quote, an explicit confirmation field and a user-retained UUID v4 idempotency key. The Imazeo API enforces quote ownership, expiry, pricing, request matching and plan admission. The server performs single attempts. Unknown or locally failed outcomes include recovery information with sanitized errors. When durable processing is disabled, use project usage to investigate uncertain outcomes before authorizing another attempt. Conversion jobs use their documented lookup route.

Local file access is opt-in and independent for reads and writes. Reads are confined to regular unlinked files below a configured root, with a combined byte limit. Each output is staged in its destination directory and linked into place exclusively, so a concurrent call cannot overwrite an existing file. Multi-page output returns any files already published if a later write fails. Use account-controlled directories to protect the local filesystem from concurrent changes by untrusted processes.

Account usage is available through the customer portal. MCP tools offer per-operation credit quotes, output counts, conversion and dynamic QR capabilities, and aggregate analytics. See [Security](../SECURITY.md) for the data transfer and credential boundaries.
