# instanceskv

instanceskv is a simple Cloudflare Worker to handle storing and partially validating configurations for the instances website. The reason it uses SHA-1 hashes for the ID's is to dedupe identical items and have a small ID. This has 2 routes:

- `POST /`: A route where you can send JSON in (max 15KB) which matches the structure in `src/schema.ts`.
- `GET /:hash`: Gets the specified item.
