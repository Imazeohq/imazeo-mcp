# Releasing Imazeo Media

Release from `Imazeohq/imazeo-mcp` with the npm package `@imazeo/mcp` and the MCP Registry name `com.imazeo/media`. Release steps require maintainer authorization.

## Release a new version

After the [first publication](#first-publication) and [trusted publisher setup](#trusted-publishing-for-subsequent-versions), start from a clean `main` with the changes you want to release committed and verified. Put any new changelog notes under `## Unreleased` before committing them.

```sh
npm ci
npm run release
```

Choose `patch`, `minor`, `major`, or enter the exact next `X.Y.Z` version. The command updates both npm manifests, the MCP manifest, the server identity and pinned client examples. It labels any unreleased changelog notes, runs the local checks, then commits and pushes `main` and the new annotated tag together. You can also pass a version explicitly with `npm run release -- 1.0.1`.

The tag starts **Release MCP package**. It builds and tests the server, uploads the checked npm tarball and matching `server.json`, and starts the protected npm publishing job. If Git rejects the push, the release command prints the exact retry command for the existing local tag and commit. To prepare just the release files, run the workflow manually on the tag with the publish checkbox clear.

## Publish to npm

### First publication

npm requires an existing package before you can add a trusted publisher. Once the `v1.0.0` commit is reachable from `origin/main`, push the tag with `git push origin tag v1.0.0` to prepare the first artifact. Download and extract it. From the directory containing the tarball, an authorized `@imazeo` maintainer can publish it with an interactive npm login and two-factor authentication. [npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/)

```sh
npm login --registry=https://registry.npmjs.org
npm publish ./imazeo-mcp-1.0.0.tgz --access public --ignore-scripts
```

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

Run `npm run release` to start publishing. To retry publication for an existing tag, run **Release MCP package** manually with the publish checkbox selected. The publish job sends the checked tarball to npm with GitHub OIDC and provenance. Verify the version and `mcpName` on npm before submitting the registry listing.

```sh
npm view @imazeo/mcp@1.0.0 version mcpName repository.url
```

Replace `1.0.0` with the version you published.

## Publish to the MCP Registry

Publish the matching npm version first. Use `server.json` from the same workflow artifact. The Registry checks the versioned npm manifest's `mcpName` against the server name in `server.json`. The artifact's manifest passes `npm run check:registry` during preparation.

Authenticate with domain verification for `imazeo.com`. With DNS verification configured, run the following from the extracted artifact directory. The key file holds the hex signing key and belongs outside the checkout. The Registry also supports HTTP verification for this namespace. [MCP Registry authentication](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/authentication.mdx) [Publisher commands](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/cli/commands.md)

```sh
mcp-publisher login dns --domain=imazeo.com --private-key-file=/secure/path/to/key.hex
mcp-publisher publish server.json
```

Verify that the listing shows `com.imazeo/media`, the released version, and the `@imazeo/mcp` stdio package.

## Submit to other registries

Registries that import the official MCP Registry can discover the listing after it is published. For direct submissions, reuse the artifact's `server.json` wherever the registry accepts the standard manifest. If it accepts individual fields, use `com.imazeo/media`, the public repository URL, and the same versioned launch command, such as `npx --yes @imazeo/mcp@1.0.0`. Declare `IMAZEO_API_KEY` as a required secret and the two local directory settings as optional. Choose the local `stdio` listing type where available. Follow each registry's account verification and submission process. [MCP Registry aggregators](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/registry-aggregators.mdx)

If a correction is needed after publication, prepare a new version and repeat the checks. Coordinate any npm deprecation or Registry withdrawal with maintainers before changing a published listing.
