import { ParliagentRequest } from "./contracts/request.js";
import type { ParliagentResponse } from "./contracts/response.js";
import { Speaker } from "./core/speaker.js";
import { loadConfig, toRuntimeConfig } from "./config.js";

export interface HandlerRequest {
  method: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface HandlerResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Thin serverless-compatible handler adapter.
 * Processes a standard HTTP-like request and returns a response object.
 *
 * Works with any runtime that can provide a request body and consume a
 * { status, headers, body } response — Vercel, AWS Lambda, Cloudflare Workers, etc.
 */
export async function handleRequest(
  req: HandlerRequest,
): Promise<HandlerResponse> {
  const corsHeaders = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    return { status: 204, headers: corsHeaders, body: "" };
  }

  if (req.method !== "POST") {
    return {
      status: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Method not allowed. Use POST." }),
    };
  }

  try {
    const parseResult = ParliagentRequest.safeParse(req.body);
    if (!parseResult.success) {
      return {
        status: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "Invalid request",
          details: parseResult.error.issues,
        }),
      };
    }

    const config = loadConfig();
    const speaker = new Speaker(toRuntimeConfig(config));
    const response: ParliagentResponse = await speaker.debate(parseResult.data);

    return {
      status: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return {
      status: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: message }),
    };
  }
}

/**
 * Vercel-style default export for serverless deployment.
 */
export default async function handler(
  req: HandlerRequest,
): Promise<HandlerResponse> {
  return handleRequest(req);
}
