import { memo, useCallback } from "react";
import { useAiChatState } from "../store/useAiChatState";
import { useRedisWorkspaceStore } from "../store/useRedisWorkspaceState";
import { AIAgent } from "./AIAgent";

interface AIAgentPanelProps {
  initialGreeting: string;
}

export const AIAgentPanel = memo(function AIAgentPanel({
  initialGreeting,
}: AIAgentPanelProps) {
  const getRuntimeContext = useCallback(() => {
    const workspace = useRedisWorkspaceStore.getState();
    const activeConnection = workspace.connections.find(
      (connection) => connection.id === workspace.activeConnectionId
    );

    return {
      activeConnection,
      selectedDb: workspace.selectedDb,
      selectedKey: workspace.selectedKey,
      keyValue: workspace.keyValue,
      keys: workspace.keys,
      onRefreshKeys: workspace.refreshKeys,
      onRefreshKeyValue: workspace.refreshKeyValue,
    };
  }, []);

  const aiChat = useAiChatState({
    initialGreeting,
    getRuntimeContext,
  });

  return (
    <AIAgent
      messages={aiChat.chatMessages}
      isResponding={aiChat.isAiResponding}
      activeToolName={aiChat.activeAiToolName}
      activeToolEvents={aiChat.activeAiToolEvents}
      activeAssistantEvents={aiChat.activeAiAssistantEvents}
      pendingCommandConfirmation={aiChat.pendingAiCommandConfirmation}
      onApproveCommand={aiChat.approveAiCommandConfirmation}
      onRejectCommand={aiChat.rejectAiCommandConfirmation}
      onSend={aiChat.sendChatMessage}
      onStop={aiChat.stopChatResponse}
    />
  );
});
