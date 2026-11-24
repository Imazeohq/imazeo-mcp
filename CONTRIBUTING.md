# Contributing

Use a supported Node.js release and run the following from the project directory.

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run check:package
npm run check:registry
```

The final check downloads the published MCP Registry schema. The other checks run without production Imazeo credentials. Use mock API responses based on the public contract. Keep fixtures synthetic and include coverage for contract changes, data disclosure, idempotency and local file handling as applicable.

Keep the public tool surface aligned with the [Imazeo API documentation](https://imazeo.com/docs/). Describe each tool's data, credits and state effects in its description and annotations. Use the official Imazeo TypeScript SDK when it matches deployed behavior. When changing the package version or tool behavior, update the release metadata and affected guides. See [releasing](docs/releasing.md) for the publishing procedure.
