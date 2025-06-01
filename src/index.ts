import schema from "./schema";
import { safeParse } from "valibot";

const textResp = (message: string, status: number) =>
    new Response(message, {
        status,
        headers: { "Access-Control-Allow-Origin": "*" },
    });

async function putJson(request: Request, env: Env): Promise<Response> {
    let j: unknown;
    try {
        j = await request.json();
    } catch {
        return textResp("Invalid JSON", 400);
    }

    const parsed = safeParse(schema, j);
    if (!parsed.success)
        return textResp(parsed.issues.map((i) => i.message).join(", "), 400);

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

    await env.INSTANCES_KV.put(idString, serialized);
    return textResp(idString, 200);
}

async function fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    let allowedMethods = "GET";
    const notAllowedResp = () =>
        new Response(`Method not allowed. Allowed methods: ${allowedMethods}`, {
            status: 405,
            headers: {
                "Access-Control-Allow-Origin": "*",
                Allow: allowedMethods,
            },
        });
    if (path === "/") {
        if (request.method === "POST") return putJson(request, env);
        allowedMethods = "POST";
        return notAllowedResp();
    }

    if (request.method !== "GET") return notAllowedResp();

    const cacheHit = await caches.default.match(url);
    if (cacheHit) return cacheHit;

    const instance = await env.INSTANCES_KV.get(path.substring(1));
    let resp: Response;
    if (instance) {
        resp = new Response(instance, {
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": allowedMethods,
                "Access-Control-Allow-Headers": "Content-Type",
                "Cache-Control": "public, max-age=604800",
            },
        });
    } else {
        resp = textResp("Not found", 404);
        resp.headers.set("Cache-Control", "public, max-age=604800");
    }
    ctx.waitUntil(caches.default.put(url, resp.clone()));
    return resp;
}

export default {
    fetch,
} satisfies ExportedHandler<Env>;
