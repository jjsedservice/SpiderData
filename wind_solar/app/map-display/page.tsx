import ExploreIcon from "@mui/icons-material/Explore";
import LayersIcon from "@mui/icons-material/Layers";
import PlaceIcon from "@mui/icons-material/Place";
import {
    Card,
    CardContent,
    Grid,
    Stack,
    Typography,
} from "@mui/material";
import NavigationShell from "../components/navigation-shell";
import { getSettingsStatus } from "@/lib/settings";

const panels = [
    {
        title: "地图主视图",
        description: "集中展示风电和太阳能点位，便于按地区和类型快速浏览。",
        icon: <ExploreIcon color="primary" />,
    },
    {
        title: "图层控制",
        description: "后续可接入风电、光伏、行政区划与容量分段等图层开关。",
        icon: <LayersIcon color="primary" />,
    },
    {
        title: "站点详情",
        description: "点击地图点位后展示企业名称、装机容量、地址和数据来源。",
        icon: <PlaceIcon color="primary" />,
    },
];

export default async function MapDisplayPage() {
    const settingsStatus = await getSettingsStatus();

    return (
        <NavigationShell
            title="数据展示"
            description="为地理编码后的风光站点预留地图展示入口。这里可以继续接入 Web 地图库、点位聚合和区域筛选能力。"
            settingsStatus={settingsStatus}
        >
            <Grid container spacing={3}>
                {panels.map((panel) => (
                    <Grid key={panel.title} size={{ xs: 12, md: 4 }}>
                        <Card
                            elevation={0}
                            sx={{
                                height: "100%",
                                borderRadius: 5,
                                border: "1px solid rgba(39, 82, 138, 0.12)",
                                backgroundColor: "rgba(255, 255, 255, 0.86)",
                            }}
                        >
                            <CardContent sx={{ p: 3.5 }}>
                                <Stack spacing={2.5}>
                                    {panel.icon}
                                    <Typography variant="h5" sx={{ fontWeight: 700 }}>
                                        {panel.title}
                                    </Typography>
                                    <Typography color="text.secondary" sx={{ lineHeight: 1.8 }}>
                                        {panel.description}
                                    </Typography>
                                </Stack>
                            </CardContent>
                        </Card>
                    </Grid>
                ))}
            </Grid>
        </NavigationShell>
    );
}
