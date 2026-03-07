import { memo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppPreferencesStore } from "../store/useAppPreferencesState";
import { useRedisWorkspaceStore } from "../store/useRedisWorkspaceState";
import { Sidebar } from "./Sidebar";

interface SidebarPanelProps {
  onOpenSettings: () => void;
}

export const SidebarPanel = memo(function SidebarPanel({
  onOpenSettings,
}: SidebarPanelProps) {
  const preferences = useAppPreferencesStore(
    useShallow((state) => ({
      confirmBeforeDelete: state.appSettings.general.confirmDelete,
      isSidebarCollapsed: state.isSidebarCollapsed,
      toggleSidebarCollapsed: state.toggleSidebarCollapsed,
    }))
  );
  const workspace = useRedisWorkspaceStore(
    useShallow((state) => ({
      activeConnectionId: state.activeConnectionId,
      connections: state.connections,
      deleteConnection: state.deleteConnection,
      disconnectConnection: state.disconnectConnection,
      openEditConnectionModal: state.openEditConnectionModal,
      openNewConnectionModal: state.openNewConnectionModal,
      panelTab: state.panelTab,
      selectConnection: state.selectConnection,
      setPanelTab: state.setPanelTab,
    }))
  );

  return (
    <Sidebar
      connections={workspace.connections}
      activeConnectionId={workspace.activeConnectionId}
      isCollapsed={preferences.isSidebarCollapsed}
      confirmBeforeDelete={preferences.confirmBeforeDelete}
      onSelectConnection={workspace.selectConnection}
      onNewConnection={workspace.openNewConnectionModal}
      onEditConnection={workspace.openEditConnectionModal}
      onDisconnectConnection={workspace.disconnectConnection}
      onDeleteConnection={workspace.deleteConnection}
      panelTab={workspace.panelTab}
      onSetPanelTab={workspace.setPanelTab}
      onToggleCollapsed={preferences.toggleSidebarCollapsed}
      onOpenSettings={onOpenSettings}
    />
  );
});
