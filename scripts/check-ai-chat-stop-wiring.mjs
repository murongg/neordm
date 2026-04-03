import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const aiChatStateSource = readFileSync(
  resolve("src/store/useAiChatState.ts"),
  "utf8"
);
const panelSource = readFileSync(resolve("src/components/AIAgentPanel.tsx"), "utf8");
const agentSource = readFileSync(resolve("src/components/AIAgent.tsx"), "utf8");

if (!aiChatStateSource.includes("const stopChatResponse = useCallback(")) {
  throw new Error("useAiChatState must expose stopChatResponse.");
}

if (!aiChatStateSource.includes("aiAbortControllerRef.current?.abort()")) {
  throw new Error("stopChatResponse must abort the active controller.");
}

if (!panelSource.includes("onStop={aiChat.stopChatResponse}")) {
  throw new Error("AIAgentPanel must pass stopChatResponse into AIAgent.");
}

if (!agentSource.includes("onStop?: () => void;")) {
  throw new Error("AIAgent props must accept onStop.");
}

if (!agentSource.includes("onClick={onStop}")) {
  throw new Error("AIAgent must wire the stop button to onStop.");
}

if (!agentSource.includes("isResponding ? (")) {
  throw new Error("AIAgent must render a dedicated stop action while responding.");
}

if (!agentSource.includes("Square")) {
  throw new Error("AIAgent stop action must use the Square icon.");
}

console.log("AI chat stop wiring check passed.");
