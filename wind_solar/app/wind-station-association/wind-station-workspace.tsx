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
import { useEffect, useEffectEvent, useMemo, useState } from "react";

declare global {
    interface Window {
        echarts?: {
            init: (element: HTMLDivElement) => {
                setOption: (option: unknown) => void;
                resize: () => void;
                dispose: () => void;
            };
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

type WindStationSession = {
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

const steps = ["聚类扫描", "场站匹配", "查看报告"];
const virtualRowHeight = 44;
const virtualTableHeight = 480;
const virtualOverscan = 8;
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
        `/api/wind-station-association/data?${new URLSearchParams({
            sessionId,
            file,
            page: "1",
            pageSize: "1000000",
        }).toString()}`,
    );
    return payload.table;
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
                        <TableRow key={`${startIndex + rowIndex}`} hover sx={{ height: virtualRowHeight }}>
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

export default function WindStationWorkspace() {
    const [scriptReady, setScriptReady] = useState(false);
    const [session, setSession] = useState<WindStationSession | null>(null);
    const [activeStep, setActiveStep] = useState(0);
    const [province, setProvince] = useState("云南");
    const [maxDistanceKm, setMaxDistanceKm] = useState("40");
    const [stepKm, setStepKm] = useState("0.5");
    const [selectedTargetDist, setSelectedTargetDist] = useState("");
    const [bestMaxDist, setBestMaxDist] = useState("100");
    const [mergeTable, setMergeTable] = useState<TablePayload>({ headers: [], rows: [], total: 0 });
    const [stationTable, setStationTable] = useState<TablePayload>({ headers: [], rows: [], total: 0 });
    const [scanLoading, setScanLoading] = useState(false);
    const [matchLoading, setMatchLoading] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

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

    async function startScan() {
        setScanLoading(true);
        setError(null);
        setMessage(null);

        try {
            const payload = await fetchJson<{ ok: true; session: WindStationSession; table: TablePayload }>(
                "/api/wind-station-association/scan",
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
            const payload = await fetchJson<{ ok: true; session: WindStationSession; table: TablePayload }>(
                "/api/wind-station-association/match",
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

    return (
        <Stack spacing={3}>
            <Script
                src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"
                strategy="afterInteractive"
                onLoad={() => setScriptReady(true)}
                onReady={() => setScriptReady(true)}
            />

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

                        <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
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
                                下一步：查看报告
                            </Button>
                        </Stack>
                    </Stack>
                ) : null}
            </DataCard>
            ) : null}

            {activeStep === 2 ? (
            <DataCard title="步骤 3：查看报告">
                <Alert severity="warning">
                    报告内容暂时留空，当前先预留流程入口。后续可以在这里补充结果摘要、异常场站、导出包等内容。
                </Alert>
                <Stack direction="row" spacing={2} justifyContent="space-between">
                    <Button variant="outlined" onClick={() => setActiveStep(1)}>
                        返回上一步
                    </Button>
                    <Button
                        variant="contained"
                        sx={{ ml: "auto" }}
                        onClick={() => setMessage("保存结果功能暂未实现，当前会话结果已经保存在 assets/tokens 目录。")}
                    >
                        保存结果
                    </Button>
                </Stack>
            </DataCard>
            ) : null}
        </Stack>
    );
}
