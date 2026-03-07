import { memo, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useRedisWorkspaceStore } from "../store/useRedisWorkspaceState";
import { ConnectionModal } from "./ConnectionModal";

export const ConnectionModalHost = memo(function ConnectionModalHost() {
  const workspace = useRedisWorkspaceStore(
    useShallow((state) => ({
      closeConnectionModal: state.closeConnectionModal,
      connections: state.connections,
      editingConnectionId: state.editingConnectionId,
      saveConnection: state.saveConnection,
      showConnectionModal: state.showConnectionModal,
    }))
  );
  const editingConnection = useMemo(
    () =>
      workspace.connections.find(
        (connection) => connection.id === workspace.editingConnectionId
      ),
    [workspace.connections, workspace.editingConnectionId]
  );

  if (!workspace.showConnectionModal) {
    return null;
  }

  return (
    <ConnectionModal
      onClose={workspace.closeConnectionModal}
      onSave={workspace.saveConnection}
      connection={editingConnection}
    />
  );
});
