import { memo, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useI18n } from "../i18n";
import { getRedisConnectionEndpointLabel } from "../lib/redisConnection";
import { useAppPreferencesStore } from "../store/useAppPreferencesState";
import { useCliState } from "../store/useCliState";
import { useRedisWorkspaceStore } from "../store/useRedisWorkspaceState";
import { RedisCLI } from "./RedisCLI";

export const RedisCLIPanel = memo(function RedisCLIPanel() {
  const { messages } = useI18n();
  const cliSettings = useAppPreferencesStore((state) => state.appSettings.cli);
  const workspace = useRedisWorkspaceStore(
    useShallow((state) => ({
      activeConnectionId: state.activeConnectionId,
      connections: state.connections,
      refreshKeys: state.refreshKeys,
      selectDb: state.selectDb,
      selectedDb: state.selectedDb,
      syncConnectionStatus: state.syncConnectionStatus,
    }))
  );
  const activeConnection = useMemo(
    () =>
      workspace.connections.find(
        (connection) => connection.id === workspace.activeConnectionId
      ),
    [workspace.activeConnectionId, workspace.connections]
  );
  const cli = useCliState({
    activeConnection,
    cliSettings,
    notConnectedMessage: messages.app.status.notConnected,
    onRefreshKeys: workspace.refreshKeys,
    onSelectDb: workspace.selectDb,
    onSyncConnectionStatus: workspace.syncConnectionStatus,
    selectedDb: workspace.selectedDb,
  });
  const connectionName = activeConnection
    ? getRedisConnectionEndpointLabel(activeConnection)
    : messages.app.status.notConnected;

  return (
    <RedisCLI
      history={cli.cliHistory}
      onClear={cli.clearCliHistory}
      onRun={cli.runCliCommand}
      connectionName={connectionName}
    />
  );
});
