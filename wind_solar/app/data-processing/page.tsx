import NavigationShell from "../components/navigation-shell";
import DataImportDashboardLoader from "./data-import-dashboard-loader";
import { getSettingsStatus } from "@/lib/settings";

export default async function DataProcessingPage() {
    const settingsStatus = await getSettingsStatus();

    return (
        <NavigationShell
            title="数据导入"
            description=""
            settingsStatus={settingsStatus}
        >
            <DataImportDashboardLoader />
        </NavigationShell>
    );
}
