import { memo, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppPreferencesStore } from "../store/useAppPreferencesState";
import { useRedisWorkspaceStore } from "../store/useRedisWorkspaceState";
import { KeyBrowser } from "./KeyBrowser";

export const KeyBrowserPanel = memo(function KeyBrowserPanel() {
  const preferences = useAppPreferencesStore(
    useShallow((state) => ({
      keySeparator: state.keySeparator,
      showKeyType: state.appSettings.appearance.showKeyType,
      showTtl: state.appSettings.appearance.showTtl,
    }))
  );
  const workspace = useRedisWorkspaceStore(
    useShallow((state) => ({
      activeConnectionId: state.activeConnectionId,
      connections: state.connections,
      isLoadingKeys: state.isLoadingKeys,
      keys: state.keys,
      refreshKeys: state.refreshKeys,
      renameGroup: state.renameGroup,
      renameKey: state.renameKey,
      searchQuery: state.searchQuery,
      selectDb: state.selectDb,
      selectedDb: state.selectedDb,
      selectedKey: state.selectedKey,
      selectKey: state.selectKey,
      setSearchQuery: state.setSearchQuery,
    }))
  );
  const activeConnection = useMemo(
    () =>
      workspace.connections.find(
        (connection) => connection.id === workspace.activeConnectionId
      ),
    [workspace.activeConnectionId, workspace.connections]
  );

  return (
    <KeyBrowser
      connection={activeConnection}
      selectedDb={workspace.selectedDb}
      onSelectDb={workspace.selectDb}
      isRefreshing={workspace.isLoadingKeys}
      onRefresh={workspace.refreshKeys}
      keySeparator={preferences.keySeparator}
      showKeyType={preferences.showKeyType}
      showTtl={preferences.showTtl}
      keys={workspace.keys}
      selectedKey={workspace.selectedKey}
      onSelectKey={workspace.selectKey}
      onRenameKey={workspace.renameKey}
      onRenameGroup={workspace.renameGroup}
      searchQuery={workspace.searchQuery}
      onSearchChange={workspace.setSearchQuery}
    />
  );
});
