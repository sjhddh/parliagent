/**
 * Normalize a JSON schema for strict-mode providers (OpenAI strict JSON schema).
 * Ensures all object properties are listed in `required`, sets
 * `additionalProperties: false`, and recursively processes nested objects.
 */
export function normalizeSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  return normalizeNode(structuredClone(schema));
}

function normalizeNode(node: Record<string, unknown>): Record<string, unknown> {
  if (node.type === "object" && node.properties) {
    const props = node.properties as Record<string, Record<string, unknown>>;
    const propNames = Object.keys(props);

    if (!node.required || !Array.isArray(node.required)) {
      node.required = propNames;
    } else {
      const existing = new Set(node.required as string[]);
      for (const name of propNames) {
        if (!existing.has(name)) {
          (node.required as string[]).push(name);
        }
      }
    }

    node.additionalProperties = false;

    for (const [key, value] of Object.entries(props)) {
      if (value && typeof value === "object") {
        props[key] = normalizeNode(value);
      }
    }
  }

  if (node.type === "array" && node.items) {
    const items = node.items as Record<string, unknown>;
    if (items && typeof items === "object") {
      node.items = normalizeNode(items);
    }
  }

  if (node.anyOf && Array.isArray(node.anyOf)) {
    node.anyOf = (node.anyOf as Record<string, unknown>[]).map(normalizeNode);
  }
  if (node.oneOf && Array.isArray(node.oneOf)) {
    node.oneOf = (node.oneOf as Record<string, unknown>[]).map(normalizeNode);
  }
  if (node.allOf && Array.isArray(node.allOf)) {
    node.allOf = (node.allOf as Record<string, unknown>[]).map(normalizeNode);
  }

  return node;
}

/**
 * Strip `additionalProperties` from a JSON schema tree.
 * Gemini's API does not recognise this keyword and rejects payloads that
 * include it.  Call this on the *already-normalised* schema before sending
 * it to Google's generateContent endpoint.
 */
export function stripAdditionalProperties(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  return stripNode(structuredClone(schema));
}

function stripNode(node: Record<string, unknown>): Record<string, unknown> {
  delete node.additionalProperties;

  if (node.properties && typeof node.properties === "object") {
    const props = node.properties as Record<string, Record<string, unknown>>;
    for (const [key, value] of Object.entries(props)) {
      if (value && typeof value === "object") {
        props[key] = stripNode(value);
      }
    }
  }

  if (node.items && typeof node.items === "object") {
    node.items = stripNode(node.items as Record<string, unknown>);
  }

  for (const combo of ["anyOf", "oneOf", "allOf"] as const) {
    if (Array.isArray(node[combo])) {
      node[combo] = (node[combo] as Record<string, unknown>[]).map(stripNode);
    }
  }

  return node;
}
