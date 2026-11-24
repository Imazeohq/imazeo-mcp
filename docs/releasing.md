# Releasing Imazeo Media

Release from `Imazeohq/imazeo-mcp` with the npm package `@imazeo/mcp` and the MCP Registry name `com.imazeo/media`. Release steps require maintainer authorization.

## Release a new version

After the [first publication](#first-publication) and [trusted publisher setup](#trusted-publishing-for-subsequent-versions), merge the changes you want to release into `main`. Put any changelog notes under `## Unreleased` before merging them.

1. Open **Actions → Create MCP release → Run workflow** and select `main`.
2. Choose `patch` for a fix, `minor` for a compatible feature, or `major` for a breaking release. Leave the confirmation checkbox clear to see the exact next tag in the run summary.
3. Run the workflow again with the same choice and check confirmation to release. GitHub checks the chosen version against npm and existing Git tags, then tests and pushes the release commit and its annotated tag together. Resolve an unpublished current tag before starting a new release.

GitHub dispatches **Release MCP package** on the new tag. That run publishes to npm through OIDC and creates a GitHub Release with the checked tarball and `server.json`. The workflow uses `GITHUB_TOKEN` to push `main` and the tag, so GitHub rules for those refs must permit the release write.

To open the workflow in your browser from a terminal, sign in to the GitHub CLI and run the following from this repository.

```sh
npm run release
```

## Publish to npm

### First publication

npm requires an existing package before you can add a trusted publisher. A publish log can show signed provenance before npm rejects the upload with `E404`. If `@imazeo/mcp` is still absent, download and extract the `imazeo-mcp-v1.0.1` artifact from the existing `v1.0.1` workflow run. If the artifact expired, run **Release MCP package** on that tag with publication unchecked to regenerate it. From the directory containing the tarball, an authorized `@imazeo` maintainer can publish it with an interactive npm login and two-factor authentication. [v1.0.1 workflow run](https://github.com/Imazeohq/imazeo-mcp/actions/runs/45367185621) · [npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/)

```sh
npm login --registry=https://registry.npmjs.org
npm publish ./imazeo-mcp-1.0.1.tgz --access public --ignore-scripts
```

If you need to select the existing tag from a terminal, run `gh workflow run publish.yml --repo Imazeohq/imazeo-mcp --ref v1.0.1 -f publish=false`.

### Trusted publishing for subsequent versions

Configure the `npm` GitHub environment with deployment rules allowing release tags. GitHub publishes automatically unless the environment has a reviewer or other approval gate. When the next version is ready, add the following trusted publisher in `@imazeo/mcp` package settings on npmjs.com. Complete its first successful publish within two days of creating the connection. [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)

| npm setting | Value |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `Imazeohq` |
| Repository | `imazeo-mcp` |
| Workflow filename | `publish.yml` |
| Environment | `npm` |
| Allowed action | Enable direct `npm publish` |

If publication still returns `E404` once the package is public, verify the exact spelling of these settings, the direct publish permission, and whether the trusted publisher configuration has expired.

### Retry an existing tag

When a later release fails before npm accepts it, fix the underlying issue and rerun the failed job for that tag. You can also run **Release MCP package** manually on the same tag and check its publish option. The GitHub CLI supports an exact tag ref if needed.

```sh
gh workflow run publish.yml --repo Imazeohq/imazeo-mcp --ref v1.0.2 -f publish=true
```

Verify the published version and `mcpName` before submitting the registry listing.

```sh
npm view @imazeo/mcp@1.0.1 version mcpName repository.url
```

Use the version you published in this command.

## Publish to the MCP Registry

Publish the matching npm version first. Use `server.json` from the same GitHub Release or workflow artifact. The Registry checks the versioned npm manifest's `mcpName` against the server name in `server.json`. The artifact's manifest passes `npm run check:registry` during preparation.

Authenticate with domain verification for `imazeo.com`. With DNS verification configured, run the following from the extracted artifact directory. The key file holds the hex signing key and belongs outside the checkout. The Registry also supports HTTP verification for this namespace. [MCP Registry authentication](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/authentication.mdx) [Publisher commands](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/cli/commands.md)

```sh
mcp-publisher login dns --domain=imazeo.com --private-key-file=/secure/path/to/key.hex
mcp-publisher publish server.json
```

Verify that the listing shows `com.imazeo/media`, the released version, and the `@imazeo/mcp` stdio package.

## Submit to other registries

Registries that import the official MCP Registry can discover the listing after it is published. For direct submissions, reuse the artifact's `server.json` wherever the registry accepts the standard manifest. If it accepts individual fields, use `com.imazeo/media`, the public repository URL, and the same versioned launch command, such as `npx --yes @imazeo/mcp@1.0.0`. Declare `IMAZEO_API_KEY` as a required secret and the two local directory settings as optional. Choose the local `stdio` listing type where available. Follow each registry's account verification and submission process. [MCP Registry aggregators](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/registry-aggregators.mdx)

If a correction is needed after publication, prepare a new version and repeat the checks. Coordinate any npm deprecation or Registry withdrawal with maintainers before changing a published listing.
