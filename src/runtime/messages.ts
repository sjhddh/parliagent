import type { ChatMessage } from "./adapter.js";

/**
 * Normalize a message array for provider compatibility:
 * - Ensures it starts with role: "system" (prepends empty one if missing)
 * - Merges consecutive same-role messages
 * - Ensures it ends with role: "user" (appends minimal prompt if needed)
 */
export function normalizeMessages(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length === 0) {
    return [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Please respond." },
    ];
  }

  const result: ChatMessage[] = [];

  if (messages[0].role !== "system") {
    result.push({ role: "system", content: "You are a helpful assistant." });
  }

  for (const msg of messages) {
    const last = result[result.length - 1];
    if (last && last.role === msg.role) {
      last.content = last.content + "\n\n" + msg.content;
    } else {
      result.push({ ...msg });
    }
  }

  const last = result[result.length - 1];
  if (last && last.role !== "user") {
    result.push({ role: "user", content: "Please continue." });
  }

  return result;
}
