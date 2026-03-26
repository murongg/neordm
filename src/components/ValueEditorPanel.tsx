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
      isLoadingKeyValue: state.isLoadingKeyValue,
      isLoadingMoreKeyValue: state.isLoadingMoreKeyValue,
      keyValue: state.keyValue,
      loadMoreKeyValue: state.loadMoreKeyValue,
      refreshKeys: state.refreshKeys,
      refreshKeyValue: state.refreshKeyValue,
      removeKeyFromState: state.removeKeyFromState,
      selectClusterNode: state.selectClusterNode,
      selectedDb: state.selectedDb,
      selectedKey: state.selectedKey,
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
    onRefreshKeyValue: workspace.refreshKeyValue,
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
      selectedKey={workspace.selectedKey}
      keyValue={workspace.keyValue}
      isLoadingKeyValue={workspace.isLoadingKeyValue}
      onRefreshKeyValue={workspace.refreshKeyValue}
      onLoadMoreKeyValue={workspace.loadMoreKeyValue}
      onDeleteKey={editor.deleteKey}
      onJumpToClusterNode={workspace.selectClusterNode}
      onUpdateStringValue={editor.updateStringValue}
      onUpdateKeyTtl={editor.updateKeyTtl}
      onUpdateJsonValue={editor.updateJsonValue}
      onAppendListValue={editor.appendListValue}
      onUpdateListValue={editor.updateListValue}
      onDeleteListValue={editor.deleteListValue}
      onAddSetMember={editor.addSetMember}
      onAddHashEntry={editor.addHashEntry}
      onUpdateHashEntry={editor.updateHashEntry}
      onDeleteHashEntry={editor.deleteHashEntry}
      onAddZSetEntry={editor.addZSetEntry}
      onUpdateZSetEntry={editor.updateZSetEntry}
      onDeleteZSetEntry={editor.deleteZSetEntry}
      isLoadingMoreKeyValue={workspace.isLoadingMoreKeyValue}
    />
  );
});
