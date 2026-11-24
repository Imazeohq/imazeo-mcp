# Releasing Imazeo Media

Release from `Imazeohq/imazeo-mcp` with the npm package `@imazeo/mcp` and the MCP Registry name `com.imazeo/media`. Release steps require maintainer authorization.

## Prepare and verify

1. Update the version in `package.json`, `package-lock.json`, `server.json`, and the server identity in `src/server.ts`. Update the changelog and the pinned client launch examples.
2. Run the CI checks described in [Contributing](../CONTRIBUTING.md). Inspect the output of `npm pack --dry-run`. Verify any API contract changes against the deployed API and developer OpenAPI before the release.
3. Wait for the CI matrix to pass. Create the matching `vMAJOR.MINOR.PATCH` tag on the approved commit reachable from `main`.

## Publish to npm

Enable private vulnerability reporting for the public repository. Configure the protected `npm` GitHub environment with required reviewers and deployment rules allowing version tags. Configure the npm trusted publisher for owner `Imazeohq`, repository `imazeo-mcp`, workflow `publish.yml` and environment `npm`. Run **Publish npm package** for the approved tag and select its publication confirmation. The workflow checks tag ancestry and package contents, then publishes with npm provenance. Verify the resulting version with `npm view @imazeo/mcp@VERSION`. [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)

For the first version, if the npm organization cannot configure the trusted publisher before the package exists, an authorized scope maintainer can publish the checked tarball with an authenticated npm account and the applicable MFA policy. Configure the trusted publisher for later versions. Keep npm credentials out of the repository and workflow.

## Publish to the MCP Registry

Publish the matching npm version first. Validate `server.json` with `npm run check:registry` or the official `mcp-publisher validate` command. The Registry checks the versioned npm manifest's `mcpName`.

Use the domain owner's authorized MCP Registry domain verification for `imazeo.com`. With DNS verification configured, run `mcp-publisher login dns --domain=imazeo.com --private-key-file PATH` from an approved release environment. Use the Registry's HTTP verification workflow if the domain owner configures that method. Keep the private signing key outside the checkout. After approval, run `mcp-publisher publish server.json`, then verify the published listing's name, version and stdio package declaration. [MCP Registry publisher commands](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/cli/commands.md)

If a correction is needed after publication, prepare a new version and repeat the checks. Coordinate any npm deprecation or Registry withdrawal with maintainers before changing a published listing.
