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
