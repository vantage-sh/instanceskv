import schema from "./schema";
import { Redis } from "@upstash/redis/cloudflare";
import { safeParse } from "valibot";

let redis: Redis;

const textResp = (message: string, status: number) =>
    new Response(message, {
        status,
        headers: { "Access-Control-Allow-Origin": "*" },
    });

async function getJson(url: URL, jsonString: string): Promise<void>;
async function getJson(url: URL, ctx: ExecutionContext): Promise<Response>;
async function getJson(
    url: URL,
    ctxOrJsonString: ExecutionContext | string,
): Promise<Response | void> {
    // Try the cache if this is a standard get request
    const isCacheWarmer = typeof ctxOrJsonString === "string";
    if (!isCacheWarmer) {
        const cacheHit = await caches.default.match(url);
        if (cacheHit) return cacheHit;
    }

    let instance: string | null;
    if (isCacheWarmer) {
        // We invoked this on ourself - use our own json string
        instance = ctxOrJsonString;
    } else {
        // Try to get the instance from the KV
        instance = await redis.get(url.pathname.substring(1));
        if (!instance) return textResp("Not found", 404);
    }

    // Create the response object. We can cache effectively infinitely because the path is a hash of the instance.
    const resp = new Response(instance, {
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET",
            "Access-Control-Allow-Headers": "Content-Type",
            "Cache-Control": "public, max-age=604800",
        },
    });

    if (!isCacheWarmer) {
        // This is a standard get request - cache outside the user waiting
        ctxOrJsonString.waitUntil(caches.default.put(url, resp.clone()));
        return resp;
    }

    // This is inside a waitUntil anyway so await the cache put
    await caches.default.put(url, resp);
}

async function putJson(
    request: Request,
    url: URL,
    ctx: ExecutionContext,
): Promise<Response> {
    // Make sure the request is a JSON object
    let j: unknown;
    try {
        j = await request.json();
    } catch {
        return textResp("Invalid JSON", 400);
    }

    // Parse the JSON object
    const parsed = safeParse(schema, j);
    if (!parsed.success)
        return textResp(parsed.issues.map((i) => i.message).join(", "), 400);

    // Check if the instance is too large
    const serialized = JSON.stringify(parsed.output);
    if (serialized.length > 15 * 1024)
        return textResp("Instance too large", 413);

    // Hash the instance
    const id = await crypto.subtle.digest(
        "SHA-1",
        new TextEncoder().encode(serialized),
    );
    const idString = Array.from(new Uint8Array(id))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

    // Check if the instance is in the cache
    url.pathname = `/${idString}`;
    const cacheHit = await caches.default.match(url);
    if (cacheHit) return textResp(idString, 200);

    // Put the instance in the KV
    await redis.set(idString, serialized);

    // Do the get to setup the cache and return the id
    ctx.waitUntil(getJson(url, serialized));
    return textResp(idString, 200);
}

async function fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
): Promise<Response> {
    const url = new URL(request.url);

    if (!redis) {
        if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
            throw new Error(
                "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set",
            );
        }
        redis = new Redis({
            url: env.UPSTASH_REDIS_REST_URL!,
            token: env.UPSTASH_REDIS_REST_TOKEN!,
        });
    }

    let allowedMethods = "GET";
    const notAllowedResp = () =>
        new Response(`Method not allowed. Allowed methods: ${allowedMethods}`, {
            status: 405,
            headers: {
                "Access-Control-Allow-Origin": "*",
                Allow: allowedMethods,
            },
        });
    if (url.pathname === "/") {
        if (request.method === "POST") return putJson(request, url, ctx);
        allowedMethods = "POST";
        return notAllowedResp();
    }

    if (request.method !== "GET") return notAllowedResp();
    return getJson(url, ctx);
}

export default {
    fetch,
} satisfies ExportedHandler<Env>;
