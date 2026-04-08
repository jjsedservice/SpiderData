"use client";

import RefreshIcon from "@mui/icons-material/Refresh";
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    Grid,
    MenuItem,
    Stack,
    TextField,
    Typography,
} from "@mui/material";
import Script from "next/script";
import { useEffect, useMemo, useRef, useState } from "react";

declare global {
    interface Window {
        T?: any;
    }
}

type EnergyType = "wind" | "solar";

type BoundaryPoint = {
    lng: number;
    lat: number;
};

type PreviewImage = {
    id: number;
    original_image: string;
    image_url: string;
};

type AssociatedRecognition = {
    id: number;
    original_image: string;
    longitude: string;
    latitude: string;
    image_url: string | null;
    distance_km: number;
};

type FarmPreview = {
    id: number;
    enterprise_name: string;
    site_name: string;
    power_type: string;
    capacity: string;
    province: string;
    longitude: number;
    latitude: number;
    associated_count: number;
    boundary: BoundaryPoint[];
    preview_images: PreviewImage[];
    associated: AssociatedRecognition[];
};

type OutlierPreview = {
    id: number;
    original_image: string;
    longitude: string;
    latitude: string;
    image_url: string | null;
};

type AssociationPreview = {
    summary: {
        farm_count: number;
        linked_farm_count: number;
        recognition_count: number;
        linked_recognition_count: number;
        outlier_count: number;
    };
    farms: FarmPreview[];
    outliers: OutlierPreview[];
};

const tianMapKey = "2d907290b8d600785e0d00bf624fd320";
const emptyPreview: AssociationPreview = {
    summary: {
        farm_count: 0,
        linked_farm_count: 0,
        recognition_count: 0,
        linked_recognition_count: 0,
        outlier_count: 0,
    },
    farms: [],
    outliers: [],
};

const provinces = [
    "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江",
    "上海", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南",
    "湖北", "湖南", "广东", "广西", "海南", "重庆", "四川", "贵州",
    "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆", "台湾",
    "香港", "澳门",
];

const compactFieldSx = {
    "& .MuiInputBase-root": {
        height: 40,
    },
    "& .MuiInputBase-input": {
        py: 1,
    },
};

async function fetchJson<T>(input: RequestInfo) {
    const response = await fetch(input);
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || "请求失败");
    }
    return payload as T;
}

export default function AssociationWorkspace() {
    const mapRef = useRef<HTMLDivElement | null>(null);
    const mapInstanceRef = useRef<any>(null);
    const overlaysRef = useRef<any[]>([]);

    const [scriptReady, setScriptReady] = useState(false);
    const [preview, setPreview] = useState<AssociationPreview | null>(null);
    const [selectedFarmId, setSelectedFarmId] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hoverPreview, setHoverPreview] = useState<{
        imageUrl: string;
        originalImage: string;
        x: number;
        y: number;
        alignRight: boolean;
        alignBottom: boolean;
    } | null>(null);
    const [filters, setFilters] = useState({
        type: "wind" as EnergyType,
        radiusKm: "5",
        province: "云南",
    });
    const summary = preview?.summary ?? emptyPreview.summary;
    const radiusMeters = Math.max(Number(filters.radiusKm) || 5, 0.1) * 1000;

    const selectedFarm = useMemo(
        () => preview?.farms.find((farm) => farm.id === selectedFarmId) ?? null,
        [preview, selectedFarmId],
    );

    useEffect(() => {
        if (window.T) {
            setScriptReady(true);
        }
    }, []);

    useEffect(() => {
        if (!scriptReady || !mapRef.current || mapInstanceRef.current || !window.T) {
            return;
        }

        const map = new window.T.Map(mapRef.current);
        map.centerAndZoom(new window.T.LngLat(102.7, 25.0), 7);
        map.enableScrollWheelZoom();
        mapInstanceRef.current = map;

        setTimeout(() => {
            map.checkResize?.();
        }, 0);
    }, [scriptReady]);

    useEffect(() => {
        if (!scriptReady) {
            return;
        }
        void loadPreview();
    }, [scriptReady, filters]);

    useEffect(() => {
        if (!mapInstanceRef.current || !preview) {
            return;
        }

        renderMap();
    }, [preview, selectedFarmId]);

    async function loadPreview() {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({
                type: filters.type,
                radiusKm: filters.radiusKm,
                province: filters.province,
            });
            const payload = await fetchJson<{ ok: true } & AssociationPreview>(
                `/api/association/preview?${params.toString()}`,
            );
            setPreview({
                summary: payload.summary,
                farms: payload.farms,
                outliers: payload.outliers,
            });
            setSelectedFarmId(null);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "加载失败");
        } finally {
            setLoading(false);
        }
    }

    function clearMapOverlays() {
        const map = mapInstanceRef.current;
        if (!map) {
            return;
        }
        setHoverPreview(null);
        overlaysRef.current.forEach((overlay) => map.removeOverLay(overlay));
        overlaysRef.current = [];
    }

    function addOverlay(overlay: any) {
        mapInstanceRef.current?.addOverLay(overlay);
        overlaysRef.current.push(overlay);
    }

    function createRecognitionMarker(point: any, item: AssociatedRecognition) {
        if (!window.T || !item.image_url) {
            return new window.T.Marker(point);
        }

        const icon = new window.T.Icon({
            iconUrl: item.image_url,
            iconSize: new window.T.Point(24, 24),
            iconAnchor: new window.T.Point(12, 12),
        });
        const marker = new window.T.Marker(point, { icon });
        const updateHoverPreview = () => {
            const map = mapInstanceRef.current;
            const container = mapRef.current;
            const pixel = map?.lngLatToContainerPoint?.(point);
            const containerWidth = container?.clientWidth ?? 0;
            const containerHeight = container?.clientHeight ?? 0;
            const x = typeof pixel?.x === "number" ? pixel.x : containerWidth / 2;
            const y = typeof pixel?.y === "number" ? pixel.y : containerHeight / 2;

            setHoverPreview({
                imageUrl: item.image_url!,
                originalImage: item.original_image,
                x,
                y,
                alignRight: x > containerWidth - 280,
                alignBottom: y > containerHeight - 280,
            });
        };

        marker.addEventListener("mouseover", () => {
            updateHoverPreview();
        });
        marker.addEventListener("mousemove", () => {
            updateHoverPreview();
        });
        marker.addEventListener("mouseout", () => {
            setHoverPreview(null);
        });

        return marker;
    }

    function renderOverviewMap() {
        const map = mapInstanceRef.current;
        if (!map || !preview) {
            return;
        }

        const points: any[] = [];

        preview.farms.forEach((farm) => {
            const point = new window.T.LngLat(farm.longitude, farm.latitude);
            points.push(point);

            const markerIcon = farm.associated_count === 0
                ? new window.T.Icon({
                    iconUrl:
                        "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='34' viewBox='0 0 24 34'><path fill='%23d32f2f' d='M12 0C5.372 0 0 5.372 0 12c0 8.6 12 22 12 22s12-13.4 12-22C24 5.372 18.628 0 12 0z'/><circle cx='12' cy='12' r='5' fill='%23ffffff'/></svg>",
                    iconSize: new window.T.Point(24, 34),
                    iconAnchor: new window.T.Point(12, 34),
                })
                : undefined;
            const marker = markerIcon ? new window.T.Marker(point, { icon: markerIcon }) : new window.T.Marker(point);
            marker.addEventListener("click", () => setSelectedFarmId(farm.id));
            addOverlay(marker);

            const label = new window.T.Label({
                text: `${farm.site_name || farm.enterprise_name} (${farm.associated_count})`,
                position: point,
                offset: new window.T.Point(-44, -56),
            });
            label.setBackgroundColor("rgba(255,255,255,0.9)");
            label.setBorderLine(1);
            label.setFontColor("#0f3d2e");
            addOverlay(label);
        });

        preview.outliers.forEach((item) => {
            const point = new window.T.LngLat(Number(item.longitude), Number(item.latitude));
            points.push(point);
            const circle = new window.T.Circle(point, 150, {
                color: "#64b5f6",
                weight: 1,
                opacity: 0.9,
                fillColor: "#bbdefb",
                fillOpacity: 0.75,
            });
            addOverlay(circle);
        });

        if (points.length) {
            map.setViewport(points);
        }
    }

    function renderFarmDetailMap(farm: FarmPreview) {
        const map = mapInstanceRef.current;
        if (!map || !window.T) {
            return;
        }

        const center = new window.T.LngLat(farm.longitude, farm.latitude);
        const farmMarker = new window.T.Marker(center);
        addOverlay(farmMarker);

        const viewportPoints = [center];
        const radiusCircle = new window.T.Circle(center, radiusMeters, {
            color: "#1565c0",
            weight: 1,
            opacity: 0.85,
            lineStyle: "dashed",
            fillColor: "#90caf9",
            fillOpacity: 0.08,
        });
        addOverlay(radiusCircle);
        farm.associated.forEach((item) => {
            const point = new window.T.LngLat(Number(item.longitude), Number(item.latitude));
            viewportPoints.push(point);
            const marker = createRecognitionMarker(point, item);
            addOverlay(marker);
        });

        if (farm.boundary.length >= 3) {
            const boundaryPoints = farm.boundary.map(
                (point) => new window.T.LngLat(point.lng, point.lat),
            );
            const polygon = new window.T.Polygon(boundaryPoints, {
                color: "#1565c0",
                weight: 2,
                opacity: 0.9,
                fillColor: "#90caf9",
                fillOpacity: 0.22,
            });
            addOverlay(polygon);
            viewportPoints.push(...boundaryPoints);
        } else if (farm.associated.length >= 2) {
            const linePoints = [
                center,
                ...farm.associated.map(
                    (item) => new window.T.LngLat(Number(item.longitude), Number(item.latitude)),
                ),
            ];
            const polyline = new window.T.Polyline(linePoints, {
                color: "#1565c0",
                weight: 2,
                opacity: 0.9,
            });
            addOverlay(polyline);
            viewportPoints.push(...linePoints);
        } else if (farm.associated.length === 1) {
            const point = new window.T.LngLat(
                Number(farm.associated[0].longitude),
                Number(farm.associated[0].latitude),
            );
            const polyline = new window.T.Polyline([center, point], {
                color: "#1565c0",
                weight: 2,
                opacity: 0.9,
            });
            addOverlay(polyline);
            viewportPoints.push(point);
        }

        if (viewportPoints.length) {
            map.setViewport(viewportPoints);
        } else {
            map.centerAndZoom(center, 12);
        }
    }

    function renderMap() {
        clearMapOverlays();
        if (selectedFarm) {
            renderFarmDetailMap(selectedFarm);
            return;
        }
        renderOverviewMap();
    }

    return (
        <>
            <Script
                src={`https://api.tianditu.gov.cn/api?v=4.0&tk=${tianMapKey}`}
                strategy="afterInteractive"
                onLoad={() => setScriptReady(true)}
                onReady={() => setScriptReady(true)}
            />

            <Stack spacing={3}>
                <Card elevation={0} sx={{ borderRadius: 5, border: "1px solid rgba(16, 74, 54, 0.1)" }}>
                    <CardContent sx={{ p: 3 }}>
                        <Stack spacing={2.5}>
                            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                                <TextField
                                    select
                                    label="类型"
                                    size="small"
                                    sx={{ minWidth: 140, ...compactFieldSx }}
                                    value={filters.type}
                                    onChange={(event) =>
                                        setFilters((current) => ({
                                            ...current,
                                            type: event.target.value as EnergyType,
                                        }))
                                    }
                                >
                                    <MenuItem value="wind">风电</MenuItem>
                                    <MenuItem value="solar">光伏</MenuItem>
                                </TextField>
                                <TextField
                                    label="关联半径(km)"
                                    size="small"
                                    sx={{ minWidth: 150, ...compactFieldSx }}
                                    value={filters.radiusKm}
                                    onChange={(event) =>
                                        setFilters((current) => ({
                                            ...current,
                                            radiusKm: event.target.value,
                                        }))
                                    }
                                />
                                <TextField
                                    select
                                    label="省份"
                                    size="small"
                                    sx={{ minWidth: 160, ...compactFieldSx }}
                                    value={filters.province}
                                    onChange={(event) =>
                                        setFilters((current) => ({
                                            ...current,
                                            province: event.target.value,
                                        }))
                                    }
                                >
                                    {provinces.map((province) => (
                                        <MenuItem key={province} value={province}>
                                            {province}
                                        </MenuItem>
                                    ))}
                                </TextField>
                                <Box sx={{ flexGrow: 1 }} />
                                <Button
                                    variant="contained"
                                    startIcon={<RefreshIcon />}
                                    onClick={() => void loadPreview()}
                                    disabled={loading || !scriptReady}
                                >
                                    重新计算关联
                                </Button>
                            </Stack>

                            <Grid container spacing={2}>
                                {[
                                    { label: "场站总数", value: summary.farm_count },
                                    { label: "已关联场站", value: summary.linked_farm_count },
                                    { label: "识别点总数", value: summary.recognition_count },
                                    { label: "已关联识别点", value: summary.linked_recognition_count },
                                    { label: "零星点", value: summary.outlier_count },
                                ].map((item) => (
                                    <Grid key={item.label} size={{ xs: 6, md: 2.4 }}>
                                        <Card
                                            elevation={0}
                                            sx={{
                                                borderRadius: 4,
                                                backgroundColor: "rgba(20,52,39,0.04)",
                                                border: "1px solid rgba(20,52,39,0.08)",
                                            }}
                                        >
                                            <CardContent sx={{ p: 2.25 }}>
                                                <Typography variant="body2" color="text.secondary">
                                                    {item.label}
                                                </Typography>
                                                <Typography variant="h4" sx={{ mt: 1, fontWeight: 700 }}>
                                                    {loading && !preview ? "--" : item.value}
                                                </Typography>
                                            </CardContent>
                                        </Card>
                                    </Grid>
                                ))}
                            </Grid>

                            {selectedFarm ? (
                                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                                    <Chip label={`当前场站: ${selectedFarm.site_name || selectedFarm.enterprise_name}`} color="primary" />
                                    <Chip label={`已关联 ${selectedFarm.associated_count} 个识别点`} />
                                    <Button size="small" onClick={() => setSelectedFarmId(null)}>
                                        返回总览
                                    </Button>
                                </Stack>
                            ) : null}

                            {error ? <Alert severity="error">{error}</Alert> : null}
                        </Stack>
                    </CardContent>
                </Card>

                <Card elevation={0} sx={{ borderRadius: 5, border: "1px solid rgba(16, 74, 54, 0.1)" }}>
                    <CardContent sx={{ p: 2 }}>
                        <Box sx={{ position: "relative", overflow: "visible", isolation: "isolate" }}>
                            <Box
                                ref={mapRef}
                                sx={{
                                    height: { xs: 480, md: 620 },
                                    borderRadius: 4,
                                    overflow: "hidden",
                                    backgroundColor: "#dfe8de",
                                }}
                            />
                            {hoverPreview ? (
                                <Box
                                    sx={{
                                        position: "absolute",
                                        left: Math.min(
                                            Math.max(hoverPreview.x + (hoverPreview.alignRight ? -276 : 16), 8),
                                            Math.max((mapRef.current?.clientWidth ?? 0) - 268, 8),
                                        ),
                                        top: Math.min(
                                            Math.max(hoverPreview.y + (hoverPreview.alignBottom ? -276 : 16), 8),
                                            Math.max((mapRef.current?.clientHeight ?? 0) - 268, 8),
                                        ),
                                        width: { xs: 180, md: 260 },
                                        p: 1,
                                        borderRadius: 2,
                                        backgroundColor: "rgba(255,255,255,0.96)",
                                        boxShadow: "0 12px 28px rgba(15, 61, 46, 0.18)",
                                        border: "1px solid rgba(15, 61, 46, 0.12)",
                                        zIndex: 9999,
                                        pointerEvents: "none",
                                    }}
                                >
                                    <Box
                                        component="img"
                                        src={hoverPreview.imageUrl}
                                        alt={hoverPreview.originalImage}
                                        sx={{
                                            display: "block",
                                            width: "100%",
                                            height: "auto",
                                            maxHeight: 320,
                                            objectFit: "contain",
                                            borderRadius: 1.5,
                                        }}
                                    />
                                </Box>
                            ) : null}
                        </Box>
                    </CardContent>
                </Card>

                {selectedFarm ? (
                    <Card elevation={0} sx={{ borderRadius: 5, border: "1px solid rgba(16, 74, 54, 0.1)" }}>
                        <CardContent sx={{ p: 3 }}>
                            <Stack spacing={2}>
                                <Typography variant="h5" sx={{ fontWeight: 700 }}>
                                    {selectedFarm.site_name || selectedFarm.enterprise_name}
                                </Typography>
                                <Typography color="text.secondary">
                                    企业名称：{selectedFarm.enterprise_name} | 发电类型：{selectedFarm.power_type} | 装机容量：{selectedFarm.capacity || "无"}
                                </Typography>
                                <Typography color="text.secondary">
                                    省份：{selectedFarm.province || "无"} | 已关联识别点：{selectedFarm.associated_count}
                                </Typography>
                                <Grid container spacing={2}>
                                    {selectedFarm.associated.filter((item) => item.image_url).length ? (
                                        selectedFarm.associated
                                            .filter((item) => item.image_url)
                                            .map((item) => (
                                            <Grid key={item.id} size={{ xs: 6, sm: 4, md: 3, lg: 2 }}>
                                                <Box
                                                    component="img"
                                                    src={item.image_url!}
                                                    alt={item.original_image}
                                                    sx={{
                                                        width: "100%",
                                                        aspectRatio: "1 / 1",
                                                        objectFit: "cover",
                                                        borderRadius: 2,
                                                        border: "1px solid rgba(0,0,0,0.08)",
                                                    }}
                                                />
                                            </Grid>
                                        ))
                                    ) : (
                                        <Grid size={12}>
                                            <Typography color="text.secondary">该场站暂无可预览图片。</Typography>
                                        </Grid>
                                    )}
                                </Grid>
                            </Stack>
                        </CardContent>
                    </Card>
                ) : null}
            </Stack>
        </>
    );
}
