"use client";

import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    FormControl,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    Step,
    StepLabel,
    Stepper,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    TextField,
    Typography,
} from "@mui/material";
import Script from "next/script";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

type AMapOverlay = {
    setMap?: (map: unknown | null) => void;
    on?: (eventName: string, handler: () => void) => void;
};

type AMapMapInstance = {
    setFitView: (overlays?: AMapOverlay[], immediately?: boolean, padding?: number[]) => void;
    setBounds: (bounds: unknown, immediately?: boolean, padding?: number[]) => void;
    resize?: () => void;
    destroy?: () => void;
};

type AMapInfoWindowInstance = {
    setContent?: (content: string) => void;
    open?: (map: unknown, position: [number, number]) => void;
    close?: () => void;
};

declare global {
    interface Window {
        echarts?: {
            init: (element: HTMLDivElement) => {
                setOption: (option: unknown) => void;
                resize: () => void;
                dispose: () => void;
            };
        };
        _AMapSecurityConfig?: {
            securityJsCode?: string;
        };
    }
}

type SessionScanPoint = {
    distanceKm: number;
    count: number;
};

type StableSegment = {
    startKm: number;
    endKm: number;
    count: number;
    length: number;
    targetDistances: string[];
    suggestedTargetDist: string;
};

type SolarStationSession = {
    id: string;
    province: string;
    createdAt: string;
    updatedAt: string;
    files: {
        merge: string | null;
        station: string | null;
    };
    scan: null | {
        maxDistanceKm: number;
        stepKm: number;
        rowCount: number;
        stationReferenceCount: number;
        scanPoints: SessionScanPoint[];
        stableSegments: StableSegment[];
        suggestedTargetDist: string | null;
        selectedTargetDist: string | null;
    };
    match: null | {
        targetDist: string;
        bestMaxDist: number;
        stationCount: number;
        scanPoints: SessionScanPoint[];
    };
};

type TablePayload = {
    headers: string[];
    rows: Array<Record<string, string>>;
    total: number;
};

type BoundaryPoint = {
    lng: number;
    lat: number;
};

type ProvinceBoundary = {
    rings: BoundaryPoint[][];
    bounds: [number, number, number, number] | null;
};

type ClusterMarkerItem = {
    clusterId: string;
    count: number;
    longitude: number;
    latitude: number;
    centerText: string;
};

type ReportStationGroup = {
    siteName: string;
    enterpriseName: string;
    subjectName: string;
    ledgerCapacityMw: number;
    estimatedCapacityMw: number;
    physicalCenter: { longitude: number; latitude: number; text: string } | null;
    panelPoints: Array<{
        longitude: number;
        latitude: number;
        imageName: string;
    }>;
    color: string;
};

const steps = ["聚类扫描", "场站匹配", "查看关联结果"];
const virtualRowHeight = 44;
const virtualTableHeight = 480;
const virtualOverscan = 8;
const reportPalette = [
    "#0f766e",
    "#1d4ed8",
    "#b45309",
    "#c2410c",
    "#7c3aed",
    "#be123c",
    "#0369a1",
    "#15803d",
    "#a16207",
    "#4338ca",
];
const compactFieldSx = {
    minWidth: 180,
    "& .MuiInputBase-root": {
        height: 40,
    },
    "& .MuiInputBase-input": {
        py: 1,
    },
};
const provinceOptions = [
    "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江",
    "上海", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南",
    "湖北", "湖南", "广东", "广西", "海南", "重庆", "四川", "贵州",
    "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆", "台湾",
    "香港", "澳门",
];
const amapKey = "3c2b3317bd1fd82708d2298085255cd5";
const amapSecurityJsCode = "f91884f9854e1876e7062f294ab42185";
const provinceAdcodeMap: Record<string, string> = {
    北京: "110000",
    天津: "120000",
    河北: "130000",
    山西: "140000",
    内蒙古: "150000",
    辽宁: "210000",
    吉林: "220000",
    黑龙江: "230000",
    上海: "310000",
    江苏: "320000",
    浙江: "330000",
    安徽: "340000",
    福建: "350000",
    江西: "360000",
    山东: "370000",
    河南: "410000",
    湖北: "420000",
    湖南: "430000",
    广东: "440000",
    广西: "450000",
    海南: "460000",
    重庆: "500000",
    四川: "510000",
    贵州: "520000",
    云南: "530000",
    西藏: "540000",
    陕西: "610000",
    甘肃: "620000",
    青海: "630000",
    宁夏: "640000",
    新疆: "650000",
    台湾: "710000",
    香港: "810000",
    澳门: "820000",
};

async function fetchJson<T>(input: RequestInfo, init?: RequestInit) {
    const response = await fetch(input, init);
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || "请求失败");
    }
    return payload as T;
}

function toCsvValue(value: unknown) {
    const text = String(value ?? "");
    if (/[",\n]/.test(text)) {
        return `"${text.replaceAll('"', '""')}"`;
    }
    return text;
}

function downloadCsv(fileName: string, headers: string[], rows: Array<Record<string, string>>) {
    const lines = [
        headers.map(toCsvValue).join(","),
        ...rows.map((row) => headers.map((header) => toCsvValue(row[header] ?? "")).join(",")),
    ];
    const blob = new Blob([`\uFEFF${lines.join("\n")}`], {
        type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
}

async function fetchAssociationTable(sessionId: string, file: "merge" | "station") {
    const payload = await fetchJson<{ ok: true; table: TablePayload }>(
        `/api/solar-station-association/data?${new URLSearchParams({
            sessionId,
            file,
            page: "1",
            pageSize: "1000000",
        }).toString()}`,
    );
    return payload.table;
}

async function loadProvinceBoundary(province: string) {
    const adcode = provinceAdcodeMap[province];
    if (!adcode) {
        return null;
    }

    const response = await fetch(`https://geo.datav.aliyun.com/areas_v3/bound/${adcode}.json`);
    const payload = await response.json();
    const rings: BoundaryPoint[][] = [];

    for (const feature of payload.features ?? []) {
        const geometry = feature.geometry;
        if (geometry?.type === "Polygon") {
            const [outerRing] = geometry.coordinates ?? [];
            if (outerRing?.length) {
                rings.push(outerRing.map(([lng, lat]: [number, number]) => ({ lng, lat })));
            }
        }
        if (geometry?.type === "MultiPolygon") {
            for (const polygon of geometry.coordinates ?? []) {
                const [outerRing] = polygon;
                if (outerRing?.length) {
                    rings.push(outerRing.map(([lng, lat]: [number, number]) => ({ lng, lat })));
                }
            }
        }
    }

    const allPoints = rings.flat();
    if (!allPoints.length) {
        return null;
    }

    return {
        rings,
        bounds: [
            Math.min(...allPoints.map((point) => point.lng)),
            Math.min(...allPoints.map((point) => point.lat)),
            Math.max(...allPoints.map((point) => point.lng)),
            Math.max(...allPoints.map((point) => point.lat)),
        ] as [number, number, number, number],
    };
}

function DataCard(props: { title: string; children: React.ReactNode }) {
    return (
        <Card
            elevation={0}
            sx={{
                borderRadius: 5,
                border: "1px solid rgba(16, 74, 54, 0.1)",
                backgroundColor: "rgba(255,255,255,0.92)",
            }}
        >
            <CardContent sx={{ p: 3.5 }}>
                <Stack spacing={3}>
                    <Typography variant="h5" sx={{ fontWeight: 700 }}>
                        {props.title}
                    </Typography>
                    {props.children}
                </Stack>
            </CardContent>
        </Card>
    );
}

function createClusterMarkerContent(item: ClusterMarkerItem) {
    return `
        <div style="
            min-width:72px;
            padding:6px 10px;
            border-radius:14px;
            background:#0f766e;
            color:#ffffff;
            text-align:center;
            box-shadow:0 8px 18px rgba(15,61,46,0.18);
            border:1px solid rgba(255,255,255,0.18);
            font-size:12px;
            line-height:1.25;
            white-space:nowrap;
        ">
            <div style="font-weight:700;">#${item.clusterId}</div>
            <div>${item.count} 台</div>
        </div>
    `;
}

function outOfChina(longitude: number, latitude: number) {
    return longitude < 72.004 || longitude > 137.8347 || latitude < 0.8293 || latitude > 55.8271;
}

function transformLatitude(x: number, y: number) {
    let result =
        -100 +
        2 * x +
        3 * y +
        0.2 * y * y +
        0.1 * x * y +
        0.2 * Math.sqrt(Math.abs(x));
    result +=
        ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
    result +=
        ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
    result +=
        ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
    return result;
}

function transformLongitude(x: number, y: number) {
    let result =
        300 +
        x +
        2 * y +
        0.1 * x * x +
        0.1 * x * y +
        0.1 * Math.sqrt(Math.abs(x));
    result +=
        ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
    result +=
        ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
    result +=
        ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
    return result;
}

function wgs84ToGcj02(longitude: number, latitude: number) {
    if (outOfChina(longitude, latitude)) {
        return { longitude, latitude };
    }

    const semiMajorAxis = 6378245;
    const eccentricity = 0.00669342162296594323;
    const deltaLat = transformLatitude(longitude - 105, latitude - 35);
    const deltaLon = transformLongitude(longitude - 105, latitude - 35);
    const radLat = (latitude / 180) * Math.PI;
    let magic = Math.sin(radLat);
    magic = 1 - eccentricity * magic * magic;
    const sqrtMagic = Math.sqrt(magic);

    const adjustedLat =
        (deltaLat * 180) /
        (((semiMajorAxis * (1 - eccentricity)) / (magic * sqrtMagic)) * Math.PI);
    const adjustedLon =
        (deltaLon * 180) /
        ((semiMajorAxis / sqrtMagic) * Math.cos(radLat) * Math.PI);

    return {
        longitude: longitude + adjustedLon,
        latitude: latitude + adjustedLat,
    };
}

function createClusterInfoContent(item: ClusterMarkerItem) {
    return `
        <div style="
            min-width:220px;
            padding:10px 12px;
            color:#15352d;
            line-height:1.5;
            font-size:13px;
        ">
            <div style="font-weight:700;margin-bottom:6px;">聚类 #${item.clusterId}</div>
            <div>光伏数量：${item.count} 组</div>
            <div>中心坐标：${item.centerText}</div>
        </div>
    `;
}

function createReportStationMarkerContent(name: string, color: string) {
    return `
        <div style="
            padding:7px 12px;
            border-radius:999px;
            background:${color};
            color:#fff;
            font-size:12px;
            font-weight:700;
            white-space:nowrap;
            box-shadow:0 8px 18px rgba(15,61,46,0.18);
            border:1px solid rgba(255,255,255,0.22);
        ">${name}</div>
    `;
}

function monotonicCross(
    origin: { longitude: number; latitude: number },
    a: { longitude: number; latitude: number },
    b: { longitude: number; latitude: number },
) {
    return (
        (a.longitude - origin.longitude) * (b.latitude - origin.latitude) -
        (a.latitude - origin.latitude) * (b.longitude - origin.longitude)
    );
}

function buildConvexHull(points: Array<{ longitude: number; latitude: number }>) {
    const unique = Array.from(
        new Map(
            points.map((point) => [`${point.longitude},${point.latitude}`, point]),
        ).values(),
    ).sort((a, b) =>
        a.longitude === b.longitude ? a.latitude - b.latitude : a.longitude - b.longitude,
    );

    if (unique.length <= 2) {
        return unique;
    }

    const lower: typeof unique = [];
    for (const point of unique) {
        while (lower.length >= 2 && monotonicCross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0) {
            lower.pop();
        }
        lower.push(point);
    }

    const upper: typeof unique = [];
    for (let index = unique.length - 1; index >= 0; index -= 1) {
        const point = unique[index]!;
        while (upper.length >= 2 && monotonicCross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0) {
            upper.pop();
        }
        upper.push(point);
    }

    lower.pop();
    upper.pop();
    return [...lower, ...upper];
}

function EChartPanel(props: {
    option: unknown;
    height?: number;
}) {
    const [container, setContainer] = useState<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!container || !window.echarts) {
            return;
        }

        const chart = window.echarts.init(container);
        chart.setOption(props.option);
        const onResize = () => chart.resize();
        window.addEventListener("resize", onResize);

        return () => {
            window.removeEventListener("resize", onResize);
            chart.dispose();
        };
    }, [container, props.option]);

    return (
        <Box
            ref={setContainer}
            sx={{
                width: "100%",
                height: props.height ?? 360,
            }}
        />
    );
}

function ResultsTable(props: {
    headers: string[];
    rows: Array<Record<string, string>>;
    highlightRows?: Set<number>;
}) {
    const [scrollTop, setScrollTop] = useState(0);
    const total = props.rows.length;
    const startIndex = Math.max(0, Math.floor(scrollTop / virtualRowHeight) - virtualOverscan);
    const visibleCount = Math.ceil(virtualTableHeight / virtualRowHeight) + virtualOverscan * 2;
    const endIndex = Math.min(total, startIndex + visibleCount);
    const visibleRows = props.rows.slice(startIndex, endIndex);
    const topSpacerHeight = startIndex * virtualRowHeight;
    const bottomSpacerHeight = Math.max(0, (total - endIndex) * virtualRowHeight);

    return (
        <Box
            sx={{
                overflow: "auto",
                maxHeight: virtualTableHeight,
                border: "1px solid rgba(16, 74, 54, 0.08)",
                borderRadius: 3,
            }}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
            <Table
                size="small"
                stickyHeader
                sx={{ minWidth: Math.max(900, props.headers.length * 140), tableLayout: "fixed" }}
            >
                <TableHead>
                    <TableRow>
                        {props.headers.map((header) => (
                            <TableCell key={header} sx={{ whiteSpace: "nowrap", backgroundColor: "#fff" }}>
                                {header}
                            </TableCell>
                        ))}
                    </TableRow>
                </TableHead>
                <TableBody>
                    {topSpacerHeight > 0 ? (
                        <TableRow>
                            <TableCell colSpan={props.headers.length} sx={{ p: 0, border: 0, height: topSpacerHeight }} />
                        </TableRow>
                    ) : null}
                    {visibleRows.map((row, rowIndex) => (
                        <TableRow
                            key={`${startIndex + rowIndex}`}
                            hover
                            sx={
                                props.highlightRows?.has(startIndex + rowIndex)
                                    ? {
                                        height: virtualRowHeight,
                                        backgroundColor: "#c62828",
                                        "& td": {
                                            color: "#fff",
                                            borderColor: "rgba(255,255,255,0.2)",
                                        },
                                        "&:hover": {
                                            backgroundColor: "#b71c1c",
                                        },
                                    }
                                    : { height: virtualRowHeight }
                            }
                        >
                            {props.headers.map((header) => (
                                <TableCell
                                    key={`${startIndex + rowIndex}-${header}`}
                                    sx={{
                                        maxWidth: 240,
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                    }}
                                >
                                    {row[header] || "-"}
                                </TableCell>
                            ))}
                        </TableRow>
                    ))}
                    {bottomSpacerHeight > 0 ? (
                        <TableRow>
                            <TableCell colSpan={props.headers.length} sx={{ p: 0, border: 0, height: bottomSpacerHeight }} />
                        </TableRow>
                    ) : null}
                </TableBody>
            </Table>
            <Box sx={{ px: 2, py: 1, color: "text.secondary", fontSize: 13 }}>
                共 {total} 行
            </Box>
        </Box>
    );
}

export default function SolarStationWorkspace() {
    const mapRef = useRef<HTMLDivElement | null>(null);
    const mapInstanceRef = useRef<AMapMapInstance | null>(null);
    const mapOverlaysRef = useRef<AMapOverlay[]>([]);
    const mapInfoWindowRef = useRef<AMapInfoWindowInstance | null>(null);
    const reportMapRef = useRef<HTMLDivElement | null>(null);
    const reportMapInstanceRef = useRef<AMapMapInstance | null>(null);
    const reportMapOverlaysRef = useRef<AMapOverlay[]>([]);
    const reportInfoWindowRef = useRef<AMapInfoWindowInstance | null>(null);
    const [scriptReady, setScriptReady] = useState(false);
    const [mapScriptReady, setMapScriptReady] = useState(false);
    const [canLoadMapScript, setCanLoadMapScript] = useState(false);
    const [session, setSession] = useState<SolarStationSession | null>(null);
    const [activeStep, setActiveStep] = useState(0);
    const [province, setProvince] = useState("云南");
    const [maxDistanceKm, setMaxDistanceKm] = useState("10");
    const [stepKm, setStepKm] = useState("0.5");
    const [selectedTargetDist, setSelectedTargetDist] = useState("");
    const [bestMaxDist, setBestMaxDist] = useState("100");
    const [mergeTable, setMergeTable] = useState<TablePayload>({ headers: [], rows: [], total: 0 });
    const [stationTable, setStationTable] = useState<TablePayload>({ headers: [], rows: [], total: 0 });
    const [provinceBoundary, setProvinceBoundary] = useState<ProvinceBoundary | null>(null);
    const [mapDistance, setMapDistance] = useState("");
    const [scanLoading, setScanLoading] = useState(false);
    const [matchLoading, setMatchLoading] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const canRenderClusterMap = activeStep === 0 && Boolean(session?.scan);
    const canRenderReportMap = activeStep === 2 && Boolean(session?.match) && Boolean(stationTable.rows.length);

    useEffect(() => {
        if (window.echarts) {
            setScriptReady(true);
            return;
        }

        const timer = window.setInterval(() => {
            if (window.echarts) {
                setScriptReady(true);
                window.clearInterval(timer);
            }
        }, 200);

        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        window._AMapSecurityConfig = {
            securityJsCode: amapSecurityJsCode,
        };
        setCanLoadMapScript(true);
        if (window.AMap) {
            setMapScriptReady(true);
        }
    }, []);

    const loadTable = useEffectEvent(async (file: "merge" | "station", sessionId?: string) => {
        const resolvedSessionId = sessionId ?? session?.id;
        if (!resolvedSessionId) {
            return;
        }

        const table = await fetchAssociationTable(resolvedSessionId, file);

        if (file === "merge") {
            setMergeTable(table);
        } else {
            setStationTable(table);
        }
    });

    useEffect(() => {
        if (!session?.id || !session.files.merge) {
            return;
        }

        void loadTable("merge");
    }, [session?.id, session?.files.merge]);

    useEffect(() => {
        if (!session?.id || !session.files.station) {
            return;
        }

        void loadTable("station");
    }, [session?.id, session?.files.station]);

    useEffect(() => {
        if (!canLoadMapScript || !window.AMap) {
            return;
        }
        setMapScriptReady(true);
    }, [canLoadMapScript]);

    useEffect(() => {
        if (!mapScriptReady || !canRenderClusterMap || !mapRef.current || mapInstanceRef.current || !window.AMap) {
            return;
        }

        const map = new window.AMap.Map(mapRef.current, {
            zoom: 6,
            center: [104.0, 35.5],
            mapStyle: "amap://styles/normal",
            viewMode: "2D",
            resizeEnable: true,
        });
        mapInstanceRef.current = map;
        mapInfoWindowRef.current = new window.AMap.InfoWindow({
            offset: new window.AMap.Pixel(0, -20),
            closeWhenClickMap: true,
        });

        if (window.AMap.DistrictLayer?.Country) {
            const countryLayer = new window.AMap.DistrictLayer.Country({
                zIndex: 8,
                SOC: "CHN",
                depth: 1,
                styles: {
                    fill: "transparent",
                    "province-stroke": "rgba(0,0,0,0)",
                    "city-stroke": "rgba(0,0,0,0)",
                    "county-stroke": "rgba(0,0,0,0)",
                    "nation-stroke": "#d32f2f",
                    "coastline-stroke": "#d32f2f",
                    "stroke-width": 2.2,
                },
            });
            countryLayer.setMap?.(map);
        }
    }, [canRenderClusterMap, mapScriptReady]);

    useEffect(() => {
        if (!mapScriptReady || !canRenderReportMap || !reportMapRef.current || reportMapInstanceRef.current || !window.AMap) {
            return;
        }

        const map = new window.AMap.Map(reportMapRef.current, {
            zoom: 6,
            center: [104.0, 35.5],
            mapStyle: "amap://styles/normal",
            viewMode: "2D",
            resizeEnable: true,
        });
        reportMapInstanceRef.current = map;
        reportInfoWindowRef.current = new window.AMap.InfoWindow({
            offset: new window.AMap.Pixel(0, -18),
            closeWhenClickMap: true,
        });
    }, [canRenderReportMap, mapScriptReady]);

    useEffect(() => {
        if (canRenderClusterMap) {
            return;
        }

        for (const overlay of mapOverlaysRef.current) {
            overlay.setMap?.(null);
        }
        mapOverlaysRef.current = [];
        mapInfoWindowRef.current?.close?.();
        mapInfoWindowRef.current = null;
        mapInstanceRef.current?.destroy?.();
        mapInstanceRef.current = null;
    }, [canRenderClusterMap]);

    useEffect(() => {
        if (canRenderReportMap) {
            return;
        }

        for (const overlay of reportMapOverlaysRef.current) {
            overlay.setMap?.(null);
        }
        reportMapOverlaysRef.current = [];
        reportInfoWindowRef.current?.close?.();
        reportInfoWindowRef.current = null;
        reportMapInstanceRef.current?.destroy?.();
        reportMapInstanceRef.current = null;
    }, [canRenderReportMap]);

    useEffect(() => {
        if (!mapScriptReady) {
            return;
        }

        let cancelled = false;
        void (async () => {
            try {
                const nextBoundary = await loadProvinceBoundary(province);
                if (!cancelled) {
                    setProvinceBoundary(nextBoundary);
                }
            } catch {
                if (!cancelled) {
                    setProvinceBoundary(null);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [mapScriptReady, province]);

    async function startScan() {
        setScanLoading(true);
        setError(null);
        setMessage(null);

        try {
            const payload = await fetchJson<{ ok: true; session: SolarStationSession; table: TablePayload }>(
                "/api/solar-station-association/scan",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        province,
                        maxDistanceKm: Number(maxDistanceKm),
                        stepKm: Number(stepKm),
                    }),
                },
            );
            setSession(payload.session);
            setMergeTable(payload.table);
            setStationTable({ headers: [], rows: [], total: 0 });
            const nextTarget =
                payload.session.scan?.suggestedTargetDist ??
                payload.session.scan?.selectedTargetDist ??
                "";
            setSelectedTargetDist(nextTarget);
            setMapDistance(nextTarget);
            setActiveStep(0);
            setMessage("聚类扫描完成。");
        } catch (scanError) {
            setError(scanError instanceof Error ? scanError.message : "聚类扫描失败");
        } finally {
            setScanLoading(false);
        }
    }

    async function startMatch() {
        if (!session?.id) {
            setError("请先完成聚类扫描");
            return;
        }
        if (!selectedTargetDist) {
            setError("请选择聚类方案距离");
            return;
        }

        setMatchLoading(true);
        setError(null);
        setMessage(null);

        try {
            const payload = await fetchJson<{ ok: true; session: SolarStationSession; table: TablePayload }>(
                "/api/solar-station-association/match",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        sessionId: session.id,
                        targetDist: selectedTargetDist,
                        bestMaxDist: Number(bestMaxDist),
                    }),
                },
            );
            setSession(payload.session);
            setStationTable(payload.table);
            setActiveStep(1);
            setBestMaxDist(String(payload.session.match?.bestMaxDist ?? (Number(bestMaxDist) || 100)));
            const fullStationTable = await fetchAssociationTable(payload.session.id, "station");
            setStationTable(fullStationTable);
            setMessage("场站匹配完成，已生成 station.csv。");
        } catch (matchError) {
            setError(matchError instanceof Error ? matchError.message : "场站匹配失败");
        } finally {
            setMatchLoading(false);
        }
    }

    const scanChartOption = useMemo(() => {
        const scanPoints = session?.scan?.scanPoints ?? [];
        const baseSeries = {
            type: "line",
            smooth: false,
            showSymbol: true,
            symbolSize: 6,
            lineStyle: { width: 2, color: "#0c8a84" },
            itemStyle: { color: "#0c8a84" },
            data: scanPoints.map((point) => [point.distanceKm, point.count]),
            markLine: selectedTargetDist
                ? {
                    symbol: "none",
                    lineStyle: { color: "#c62828", type: "dashed", width: 2 },
                    label: { formatter: `当前选择 ${selectedTargetDist}` },
                    data: [{ xAxis: Number.parseFloat(selectedTargetDist) }],
                }
                : undefined,
        };

        return {
            tooltip: { trigger: "axis" },
            grid: { left: 52, right: 24, top: 36, bottom: 42 },
            xAxis: {
                type: "value",
                name: "聚类距离 (km)",
                nameLocation: "middle",
                nameGap: 28,
                min: 0,
            },
            yAxis: {
                type: "value",
                name: "聚类数",
            },
            series: [baseSeries],
        };
    }, [selectedTargetDist, session?.scan]);

    const matchChartOption = useMemo(() => {
        const matchPoints = session?.match?.scanPoints ?? [];
        const appliedBestMaxDist = session?.match?.bestMaxDist ?? (Number(bestMaxDist) || 100);
        return {
            tooltip: { trigger: "axis" },
            grid: { left: 52, right: 24, top: 36, bottom: 42 },
            xAxis: {
                type: "value",
                name: "匹配半径 (km)",
                nameLocation: "middle",
                nameGap: 28,
                min: 0,
            },
            yAxis: {
                type: "value",
                name: "匹配场站数",
            },
            series: [
                {
                    type: "line",
                    smooth: false,
                    showSymbol: true,
                    symbolSize: 6,
                    lineStyle: { width: 2, color: "#2e7d32" },
                    itemStyle: { color: "#2e7d32" },
                    data: matchPoints.map((point) => [point.distanceKm, point.count]),
                    markLine: {
                        symbol: "none",
                        lineStyle: { color: "#c62828", type: "dashed", width: 2 },
                        label: { formatter: `当前匹配距离 ${appliedBestMaxDist}km` },
                        data: [{ xAxis: appliedBestMaxDist }],
                    },
                },
            ],
        };
    }, [bestMaxDist, session?.match]);

    const mapDistanceOptions = useMemo(
        () => session?.scan?.scanPoints.map((point) => `${point.distanceKm.toFixed(1)}km`) ?? [],
        [session?.scan?.scanPoints],
    );

    const clusterMarkers = useMemo(() => {
        if (!mapDistance) {
            return [] as ClusterMarkerItem[];
        }

        const idColumn = `${mapDistance}_聚类序号`;
        const centerColumn = `${mapDistance}_聚类中心`;
        const grouped = new Map<string, ClusterMarkerItem>();

        for (const row of mergeTable.rows) {
            const clusterId = String(row[idColumn] ?? "").trim();
            const center = String(row[centerColumn] ?? "").trim();
            if (!clusterId || !center) {
                continue;
            }

            const [longitudeText, latitudeText] = center.split(",");
            const longitude = Number(longitudeText);
            const latitude = Number(latitudeText);
            if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
                continue;
            }
            const gcjPoint = wgs84ToGcj02(longitude, latitude);

            const current = grouped.get(clusterId) ?? {
                clusterId,
                count: 0,
                longitude: gcjPoint.longitude,
                latitude: gcjPoint.latitude,
                centerText: center,
            };
            current.count += 1;
            grouped.set(clusterId, current);
        }

        return [...grouped.values()].sort((a, b) => Number(a.clusterId) - Number(b.clusterId));
    }, [mapDistance, mergeTable.rows]);

    const reportGroups = useMemo(() => {
        const targetDist = session?.match?.targetDist;
        if (!targetDist || !stationTable.rows.length || !mergeTable.rows.length) {
            return [] as ReportStationGroup[];
        }

        const idColumn = `${targetDist}_聚类序号`;
        const stationByClusterId = new Map<
            string,
            Omit<ReportStationGroup, "panelPoints" | "color">
        >();

        for (const row of stationTable.rows) {
            const clusterId = String(row["聚类序号"] ?? "").trim();
            if (!clusterId) {
                continue;
            }
            const centerText = String(row["物理中心"] ?? "").trim();
            const [longitudeText, latitudeText] = centerText.split(",");
            const centerLongitude = Number(longitudeText);
            const centerLatitude = Number(latitudeText);

            stationByClusterId.set(clusterId, {
                siteName: String(row["站点名称"] ?? ""),
                enterpriseName: String(row["企业名称"] ?? ""),
                subjectName: String(row["主体名称"] ?? ""),
                ledgerCapacityMw: Number(row["台账容量"] ?? 0) || 0,
                estimatedCapacityMw: Number(row["预估容量"] ?? 0) || 0,
                physicalCenter:
                    Number.isFinite(centerLongitude) && Number.isFinite(centerLatitude)
                        ? {
                            longitude: centerLongitude,
                            latitude: centerLatitude,
                            text: centerText,
                        }
                        : null,
            });
        }

        const grouped = new Map<string, ReportStationGroup>();

        for (const row of mergeTable.rows) {
            const clusterId = String(row[idColumn] ?? "").trim();
            if (!clusterId) {
                continue;
            }
            const station = stationByClusterId.get(clusterId);
            if (!station) {
                continue;
            }

            const longitude = Number(String(row["经度"] ?? ""));
            const latitude = Number(String(row["纬度"] ?? ""));
            if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
                continue;
            }

            const siteKey = station.siteName || clusterId;
            const current = grouped.get(siteKey) ?? {
                ...station,
                panelPoints: [],
                color: reportPalette[grouped.size % reportPalette.length]!,
            };

            current.panelPoints.push({
                longitude,
                latitude,
                imageName: String(row["原始图片"] ?? ""),
            });
            grouped.set(siteKey, current);
        }

        return [...grouped.values()];
    }, [mergeTable.rows, session?.match?.targetDist, stationTable.rows]);

    const reportSummary = useMemo(() => {
        const ledgerCapacityMw = reportGroups.reduce((sum, group) => sum + group.ledgerCapacityMw, 0);
        const estimatedCapacityMw = reportGroups.reduce(
            (sum, group) => sum + group.estimatedCapacityMw,
            0,
        );
        return {
            ledgerCapacityMw,
            estimatedCapacityMw,
        };
    }, [reportGroups]);

    useEffect(() => {
        if (!mapDistance && mapDistanceOptions.length) {
            setMapDistance(mapDistanceOptions[0] ?? "");
        }
    }, [mapDistance, mapDistanceOptions]);

    useEffect(() => {
        if (!canRenderClusterMap) {
            return;
        }

        const map = mapInstanceRef.current;
        if (!map || !window.AMap) {
            return;
        }

        for (const overlay of mapOverlaysRef.current) {
            overlay.setMap?.(null);
        }
        mapOverlaysRef.current = [];

        const nextOverlays: AMapOverlay[] = [];

        for (const ring of provinceBoundary?.rings ?? []) {
            const polygon = new window.AMap.Polygon({
                path: ring.map((point) => [point.lng, point.lat]),
                strokeColor: "#0f766e",
                strokeOpacity: 0.95,
                strokeWeight: 2.2,
                fillColor: "#0f766e",
                fillOpacity: 0.03,
                zIndex: 12,
            });
            polygon.setMap(map);
            nextOverlays.push(polygon);
        }

        for (const item of clusterMarkers) {
            const marker = new window.AMap.Marker({
                position: [item.longitude, item.latitude],
                offset: new window.AMap.Pixel(-36, -18),
                content: createClusterMarkerContent(item),
                zIndex: 16,
            });
            marker.on?.("click", () => {
                mapInfoWindowRef.current?.setContent?.(createClusterInfoContent(item));
                mapInfoWindowRef.current?.open?.(map, [item.longitude, item.latitude]);
            });
            marker.setMap(map);
            nextOverlays.push(marker);
        }

        mapOverlaysRef.current = nextOverlays;

        if (clusterMarkers.length) {
            map.setFitView(nextOverlays, false, [70, 40, 40, 40]);
            return;
        }

        if (provinceBoundary?.bounds) {
            const [minLng, minLat, maxLng, maxLat] = provinceBoundary.bounds;
            map.setBounds(
                new window.AMap.Bounds([minLng, minLat], [maxLng, maxLat]),
                false,
                [70, 40, 40, 40],
            );
        }
    }, [canRenderClusterMap, clusterMarkers, provinceBoundary]);

    useEffect(() => {
        if (!canRenderClusterMap) {
            return;
        }

        const timer = window.setTimeout(() => {
            mapInstanceRef.current?.resize?.();
        }, 50);

        return () => window.clearTimeout(timer);
    }, [canRenderClusterMap, clusterMarkers.length, provinceBoundary?.bounds]);

    useEffect(() => {
        const map = reportMapInstanceRef.current;
        if (!canRenderReportMap || !map || !window.AMap) {
            return;
        }

        for (const overlay of reportMapOverlaysRef.current) {
            overlay.setMap?.(null);
        }
        reportMapOverlaysRef.current = [];

        const nextOverlays: AMapOverlay[] = [];

        for (const ring of provinceBoundary?.rings ?? []) {
            const polygon = new window.AMap.Polygon({
                path: ring.map((point) => [point.lng, point.lat]),
                strokeColor: "#0f766e",
                strokeOpacity: 0.95,
                strokeWeight: 2,
                fillColor: "#0f766e",
                fillOpacity: 0.02,
                zIndex: 8,
            });
            polygon.setMap(map);
            nextOverlays.push(polygon);
        }

        for (const group of reportGroups) {
            const gcjTurbinePoints = group.panelPoints.map((point) => ({
                ...wgs84ToGcj02(point.longitude, point.latitude),
                imageName: point.imageName,
            }));

            const hull = buildConvexHull(
                gcjTurbinePoints.map((point) => ({
                    longitude: point.longitude,
                    latitude: point.latitude,
                })),
            );
            if (hull.length >= 3) {
                const polygon = new window.AMap.Polygon({
                    path: hull.map((point) => [point.longitude, point.latitude]),
                    strokeColor: group.color,
                    strokeWeight: 3,
                    strokeOpacity: 0.95,
                    fillColor: group.color,
                    fillOpacity: 0.06,
                    zIndex: 12,
                });
                polygon.setMap(map);
                nextOverlays.push(polygon);
            }

            if (group.physicalCenter) {
                const center = wgs84ToGcj02(group.physicalCenter.longitude, group.physicalCenter.latitude);
                const marker = new window.AMap.Marker({
                    position: [center.longitude, center.latitude],
                    offset: new window.AMap.Pixel(-36, -18),
                    content: createReportStationMarkerContent(group.siteName, group.color),
                    zIndex: 16,
                });
                marker.setMap(map);
                nextOverlays.push(marker);
            }

            for (const turbinePoint of gcjTurbinePoints) {
                const circleMarker = new window.AMap.CircleMarker({
                    center: [turbinePoint.longitude, turbinePoint.latitude],
                    radius: 5,
                    strokeColor: "#ffffff",
                    strokeWeight: 2,
                    strokeOpacity: 0.95,
                    fillColor: "#ef4444",
                    fillOpacity: 0.95,
                    zIndex: 18,
                    bubble: true,
                    cursor: "pointer",
                });
                circleMarker.on?.("mouseover", () => {
                    if (!reportInfoWindowRef.current) {
                        return;
                    }
                    reportInfoWindowRef.current.setContent?.(`
                        <div style="padding:8px;background:#fff;">
                            <div style="font-size:12px;font-weight:700;margin-bottom:6px;color:#15352d;">${group.siteName}</div>
                            <img
                                src="/api/recognition/image?type=solar&name=${encodeURIComponent(turbinePoint.imageName)}"
                                alt="${turbinePoint.imageName}"
                                style="display:block;width:220px;max-width:220px;height:auto;border-radius:8px;"
                            />
                            <div style="margin-top:6px;font-size:12px;color:#48645c;">${turbinePoint.imageName}</div>
                        </div>
                    `);
                    reportInfoWindowRef.current.open?.(map, [turbinePoint.longitude, turbinePoint.latitude]);
                });
                circleMarker.on?.("mouseout", () => {
                    reportInfoWindowRef.current?.close?.();
                });
                circleMarker.setMap(map);
                nextOverlays.push(circleMarker);
            }
        }

        reportMapOverlaysRef.current = nextOverlays;

        if (nextOverlays.length) {
            map.setFitView(nextOverlays, false, [70, 40, 40, 40]);
            return;
        }

        if (provinceBoundary?.bounds) {
            const [minLng, minLat, maxLng, maxLat] = provinceBoundary.bounds;
            map.setBounds(
                new window.AMap.Bounds([minLng, minLat], [maxLng, maxLat]),
                false,
                [70, 40, 40, 40],
            );
        }
    }, [canRenderReportMap, provinceBoundary, reportGroups]);

    useEffect(() => {
        if (!canRenderReportMap) {
            return;
        }

        const timer = window.setTimeout(() => {
            reportMapInstanceRef.current?.resize?.();
        }, 50);

        return () => window.clearTimeout(timer);
    }, [canRenderReportMap, reportGroups.length, provinceBoundary?.bounds]);

    return (
        <Stack spacing={3}>
            <Script
                src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"
                strategy="afterInteractive"
                onLoad={() => setScriptReady(true)}
                onReady={() => setScriptReady(true)}
            />
            {canLoadMapScript ? (
                <Script
                    src={`https://webapi.amap.com/maps?v=2.0&key=${amapKey}&plugin=AMap.DistrictLayer`}
                    strategy="afterInteractive"
                    onLoad={() => setMapScriptReady(true)}
                    onReady={() => setMapScriptReady(true)}
                />
            ) : null}

            <Card
                elevation={0}
                sx={{
                    borderRadius: 5,
                    border: "1px solid rgba(16, 74, 54, 0.1)",
                    backgroundColor: "rgba(255,255,255,0.88)",
                }}
            >
                <CardContent sx={{ p: 3.5 }}>
                    <Stepper activeStep={activeStep} alternativeLabel>
                        {steps.map((label) => (
                            <Step key={label}>
                                <StepLabel>{label}</StepLabel>
                            </Step>
                        ))}
                    </Stepper>
                </CardContent>
            </Card>

            {message ? <Alert severity="success">{message}</Alert> : null}
            {error ? <Alert severity="error">{error}</Alert> : null}

            {activeStep === 0 ? (
            <DataCard title="步骤 1：聚类扫描">
                <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                    <FormControl size="small" sx={compactFieldSx}>
                        <InputLabel>省份</InputLabel>
                        <Select
                            label="省份"
                            value={province}
                            onChange={(event) => setProvince(String(event.target.value))}
                        >
                            {provinceOptions.map((option) => (
                                <MenuItem key={option} value={option}>
                                    {option}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <TextField
                        size="small"
                        label="扫描距离上限 (km)"
                        sx={compactFieldSx}
                        value={maxDistanceKm}
                        onChange={(event) => setMaxDistanceKm(event.target.value)}
                    />
                    <TextField
                        size="small"
                        label="步长 (km)"
                        sx={compactFieldSx}
                        value={stepKm}
                        onChange={(event) => setStepKm(event.target.value)}
                    />
                    <Box sx={{ flexGrow: 1 }} />
                    <Button variant="contained" onClick={() => void startScan()} disabled={scanLoading}>
                        {scanLoading ? "扫描中..." : "开始扫描"}
                    </Button>
                </Stack>

                {session?.scan ? (
                    <Stack spacing={3}>
                        <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ md: "center" }}>
                            <Typography variant="body1" sx={{ fontWeight: 600 }}>
                                自动选择的聚类方案距离：{selectedTargetDist || "无"}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                红色虚线表示自动选择的取值。规则是：从左到右找到第一个台阶，也就是第一次出现相邻两个距离聚类数量相同的情况，并取这两个值中的较大值。当前省份场站数：{session.scan.stationReferenceCount}
                            </Typography>
                        </Stack>

                        {scriptReady ? <EChartPanel option={scanChartOption} /> : <Alert severity="info">图表脚本加载中...</Alert>}

                        <Box sx={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 2 }}>
                            <Button
                                variant="text"
                                onClick={() => downloadCsv("merge.csv", mergeTable.headers, mergeTable.rows)}
                                disabled={!mergeTable.headers.length || !mergeTable.rows.length}
                            >
                                导出表格
                            </Button>
                        </Box>
                        <ResultsTable
                            headers={mergeTable.headers}
                            rows={mergeTable.rows}
                        />
                        <Box
                            sx={{
                                position: "relative",
                                borderRadius: 4,
                                overflow: "hidden",
                                border: "1px solid rgba(16, 74, 54, 0.12)",
                                backgroundColor: "#f7fbfa",
                            }}
                        >
                            <Box
                                sx={{
                                    position: "absolute",
                                    top: 16,
                                    left: 16,
                                    zIndex: 2,
                                    p: 1.5,
                                    borderRadius: 3,
                                    backgroundColor: "rgba(255,255,255,0.94)",
                                    boxShadow: "0 8px 24px rgba(15,61,46,0.12)",
                                }}
                            >
                                <FormControl size="small" sx={{ minWidth: 180 }}>
                                    <InputLabel>聚类公里数</InputLabel>
                                    <Select
                                        label="聚类公里数"
                                        value={mapDistance}
                                        onChange={(event) => setMapDistance(String(event.target.value))}
                                    >
                                        {mapDistanceOptions.map((option) => (
                                            <MenuItem key={option} value={option}>
                                                {option}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                            </Box>
                            {mapScriptReady ? (
                                <Box
                                    ref={mapRef}
                                    sx={{
                                        width: "100%",
                                        height: 520,
                                    }}
                                />
                            ) : (
                                <Alert severity="info" sx={{ m: 2 }}>
                                    地图脚本加载中...
                                </Alert>
                            )}
                        </Box>
                        <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                            <Button
                                variant="outlined"
                                onClick={() => setActiveStep(1)}
                                disabled={!selectedTargetDist}
                            >
                                下一步：场站匹配
                            </Button>
                        </Box>
                    </Stack>
                ) : null}
            </DataCard>
            ) : null}

            {activeStep === 1 ? (
            <DataCard title="步骤 2：场站匹配">
                <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ md: "center" }}>
                    <Typography variant="body1">
                        当前聚类方案：{selectedTargetDist || "请先完成上一步并选择聚类距离"}
                    </Typography>
                    <TextField
                        size="small"
                        label="匹配搜索距离 (km)"
                        sx={compactFieldSx}
                        value={bestMaxDist}
                        onChange={(event) => setBestMaxDist(event.target.value)}
                    />
                    <Box sx={{ flexGrow: 1 }} />
                    <Button
                        variant="contained"
                        onClick={() => void startMatch()}
                        disabled={!session?.scan || !selectedTargetDist || matchLoading}
                    >
                        {matchLoading ? "匹配中..." : "开始匹配"}
                    </Button>
                </Stack>

                {session?.match ? (
                    <Stack spacing={3}>
                        {scriptReady ? <EChartPanel option={matchChartOption} /> : <Alert severity="info">图表脚本加载中...</Alert>}
                        <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                            <Button
                                variant="text"
                                onClick={() => downloadCsv("station.csv", stationTable.headers, stationTable.rows)}
                                disabled={!stationTable.headers.length || !stationTable.rows.length}
                            >
                                导出表格
                            </Button>
                        </Box>
                        <ResultsTable
                            headers={stationTable.headers}
                            rows={stationTable.rows}
                        />
                        <Stack direction="row" spacing={2} justifyContent="space-between">
                            <Button variant="outlined" onClick={() => setActiveStep(0)}>
                                返回上一步
                            </Button>
                            <Button variant="outlined" sx={{ ml: "auto" }} onClick={() => setActiveStep(2)}>
                                下一步：查看关联结果
                            </Button>
                        </Stack>
                    </Stack>
                ) : null}
            </DataCard>
            ) : null}

            {activeStep === 2 ? (
            <DataCard title="步骤 3：查看关联结果">
                <Stack spacing={3}>
                    <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                        <Card
                            elevation={0}
                            sx={{
                                flex: 1,
                                borderRadius: 4,
                                border: "1px solid rgba(16, 74, 54, 0.1)",
                                backgroundColor: "#f7fbfa",
                            }}
                        >
                            <CardContent>
                                <Typography variant="overline" color="text.secondary">
                                    账面容量
                                </Typography>
                                <Typography variant="h4" sx={{ fontWeight: 700 }}>
                                    {(reportSummary.ledgerCapacityMw / 1000).toFixed(3)} GW
                                </Typography>
                            </CardContent>
                        </Card>
                        <Card
                            elevation={0}
                            sx={{
                                flex: 1,
                                borderRadius: 4,
                                border: "1px solid rgba(16, 74, 54, 0.1)",
                                backgroundColor: "#f7fbfa",
                            }}
                        >
                            <CardContent>
                                <Typography variant="overline" color="text.secondary">
                                    预计容量
                                </Typography>
                                <Typography variant="h4" sx={{ fontWeight: 700 }}>
                                    {(reportSummary.estimatedCapacityMw / 1000).toFixed(3)} GW
                                </Typography>
                            </CardContent>
                        </Card>
                    </Stack>

                    <Box
                        sx={{
                            position: "relative",
                            borderRadius: 4,
                            overflow: "hidden",
                            border: "1px solid rgba(16, 74, 54, 0.12)",
                            backgroundColor: "#f7fbfa",
                        }}
                    >
                        {mapScriptReady ? (
                            <Box
                                ref={reportMapRef}
                                sx={{
                                    width: "100%",
                                    height: 640,
                                }}
                            />
                        ) : (
                            <Alert severity="info" sx={{ m: 2 }}>
                                地图脚本加载中...
                            </Alert>
                        )}
                    </Box>

                    <Stack direction="row" spacing={2} justifyContent="space-between">
                        <Button variant="outlined" onClick={() => setActiveStep(1)}>
                            返回上一步
                        </Button>
                    </Stack>
                </Stack>
            </DataCard>
            ) : null}
        </Stack>
    );
}
