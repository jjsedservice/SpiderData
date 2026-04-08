import NavigationShell from "../components/navigation-shell";
import AssociationWorkspaceLoader from "./association-workspace-loader";
import { getSettingsStatus } from "@/lib/settings";

export default async function MapDisplayPage() {
    const settingsStatus = await getSettingsStatus();

    return (
        <NavigationShell
            title="场站关联"
            description="按关联半径自动关联场站与识别点，并在天地图上预览场站覆盖区域、已关联数量和零星点。"
            settingsStatus={settingsStatus}
        >
            <AssociationWorkspaceLoader />
        </NavigationShell>
    );
}
