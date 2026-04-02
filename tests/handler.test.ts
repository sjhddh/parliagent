import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleRequest } from "../src/handler.js";

describe("handleRequest", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY", "FLOCK_API_KEY", "FLOCK_MODEL"]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val !== undefined) process.env[key] = val;
      else delete process.env[key];
    }
  });

  it("returns 204 for OPTIONS (CORS preflight)", async () => {
    const response = await handleRequest({ method: "OPTIONS" });
    expect(response.status).toBe(204);
    expect(response.headers["Access-Control-Allow-Origin"]).toBe("*");
  });

  it("returns 405 for GET requests", async () => {
    const response = await handleRequest({ method: "GET" });
    expect(response.status).toBe(405);
    const body = JSON.parse(response.body);
    expect(body.error).toContain("Method not allowed");
  });

  it("returns 400 for invalid request body", async () => {
    const response = await handleRequest({
      method: "POST",
      body: { prompt: "" },
    });
    expect(response.status).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe("Invalid request");
    expect(body.details).toBeDefined();
  });

  it("returns 400 for missing prompt", async () => {
    const response = await handleRequest({
      method: "POST",
      body: {},
    });
    expect(response.status).toBe(400);
  });

  it("returns 500 when no provider is configured", async () => {
    const response = await handleRequest({
      method: "POST",
      body: { prompt: "test question" },
    });
    expect(response.status).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.error).toContain("No model provider");
  });

  it("includes CORS headers on all responses", async () => {
    const response = await handleRequest({
      method: "POST",
      body: { prompt: "test" },
    });
    expect(response.headers["Content-Type"]).toBe("application/json");
    expect(response.headers["Access-Control-Allow-Origin"]).toBe("*");
  });
});
