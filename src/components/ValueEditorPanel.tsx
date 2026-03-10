import { memo, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useI18n } from "../i18n";
import { useRedisValueEditorState } from "../store/useRedisValueEditorState";
import { useRedisWorkspaceStore } from "../store/useRedisWorkspaceState";
import { ValueEditor } from "./ValueEditor";

export const ValueEditorPanel = memo(function ValueEditorPanel() {
  const { messages } = useI18n();
  const workspace = useRedisWorkspaceStore(
    useShallow((state) => ({
      activeConnectionId: state.activeConnectionId,
      connections: state.connections,
      keyValue: state.keyValue,
      refreshKeys: state.refreshKeys,
      refreshKeyValue: state.refreshKeyValue,
      removeKeyFromState: state.removeKeyFromState,
      selectClusterNode: state.selectClusterNode,
      selectedDb: state.selectedDb,
      setKeyValue: state.setKeyValue,
    }))
  );
  const activeConnection = useMemo(
    () =>
      workspace.connections.find(
        (connection) => connection.id === workspace.activeConnectionId
      ),
    [workspace.activeConnectionId, workspace.connections]
  );
  const editor = useRedisValueEditorState({
    activeConnection,
    keyValue: workspace.keyValue,
    notConnectedMessage: messages.app.status.notConnected,
    onRefreshKeys: workspace.refreshKeys,
    removeKeyFromState: workspace.removeKeyFromState,
    selectedDb: workspace.selectedDb,
    setKeyValue: workspace.setKeyValue,
  });

  return (
    <ValueEditor
      activeConnection={activeConnection}
      selectedDb={workspace.selectedDb}
      keyValue={workspace.keyValue}
      onRefreshKeyValue={workspace.refreshKeyValue}
      onDeleteKey={editor.deleteKey}
      onJumpToClusterNode={workspace.selectClusterNode}
      onUpdateStringValue={editor.updateStringValue}
      onUpdateKeyTtl={editor.updateKeyTtl}
      onUpdateJsonValue={editor.updateJsonValue}
      onUpdateHashEntry={editor.updateHashEntry}
      onDeleteHashEntry={editor.deleteHashEntry}
      onUpdateZSetEntry={editor.updateZSetEntry}
      onDeleteZSetEntry={editor.deleteZSetEntry}
    />
  );
});
