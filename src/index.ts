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

    const id = crypto.randomUUID();
    await env.INSTANCES_KV.put(id, serialized);
    return textResp(id, 200);
}

async function fetch(request: Request, env: Env): Promise<Response> {
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

    const instance = await env.INSTANCES_KV.get(path.substring(1));
    if (!instance) return textResp("Not found", 404);

    return new Response(instance, {
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": allowedMethods,
            "Access-Control-Allow-Headers": "Content-Type",
        },
    });
}

export default {
    fetch,
} satisfies ExportedHandler<Env>;
