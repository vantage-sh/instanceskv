import schema from "./schema";
import { safeParse } from "valibot";

const textResp = (message: string, status: number) =>
    new Response(message, {
        status,
        headers: { "Access-Control-Allow-Origin": "*" },
    });

async function getJson(url: URL, jsonString: string): Promise<void>;
async function getJson(
    url: URL,
    env: Env,
    ctx: ExecutionContext,
): Promise<Response>;
async function getJson(
    url: URL,
    envOrJsonString: Env | string,
    ctx?: ExecutionContext,
): Promise<Response | void> {
    // Try the cache if this is a standard get request
    if (ctx) {
        const cacheHit = await caches.default.match(url);
        if (cacheHit) return cacheHit;
    }

    let instance: string | null;
    if (typeof envOrJsonString === "string") {
        // We invoked this on ourself - use our own json string
        instance = envOrJsonString;
    } else {
        // Try to get the instance from the KV
        instance = await envOrJsonString.INSTANCES_KV.get(
            url.pathname.substring(1),
        );
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

    if (ctx) {
        // This is a standard get request - cache outside the user waiting
        ctx.waitUntil(caches.default.put(url, resp.clone()));
        return resp;
    }

    // This is inside a waitUntil anyway so await the cache put
    await caches.default.put(url, resp);
}

async function putJson(
    request: Request,
    url: URL,
    env: Env,
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
    await env.INSTANCES_KV.put(idString, serialized);

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
        if (request.method === "POST") return putJson(request, url, env, ctx);
        allowedMethods = "POST";
        return notAllowedResp();
    }

    if (request.method !== "GET") return notAllowedResp();
    return getJson(url, env, ctx);
}

export default {
    fetch,
} satisfies ExportedHandler<Env>;
