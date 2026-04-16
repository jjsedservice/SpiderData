import NavigationShell from "../components/navigation-shell";
import SolarStationWorkspaceLoader from "./solar-station-workspace-loader";
import { getSettingsStatus } from "@/lib/settings";

export default async function SolarStationAssociationPage() {
    const settingsStatus = await getSettingsStatus();

    return (
        <NavigationShell
            title="光伏电场关联"
            description="按省份对光伏识别点执行聚类扫描、台账匹配和结果复核。每次扫描都会生成一个独立会话目录，便于复用中间结果。"
            settingsStatus={settingsStatus}
        >
            <SolarStationWorkspaceLoader />
        </NavigationShell>
    );
}
