"use client";

import AddIcon from "@mui/icons-material/Add";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import DownloadIcon from "@mui/icons-material/Download";
import {
    Alert,
    Autocomplete,
    Box,
    Button,
    Card,
    CardActions,
    CardContent,
    Checkbox,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    FormControlLabel,
    InputLabel,
    LinearProgress,
    MenuItem,
    Select,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TablePagination,
    TableRow,
    TextField,
    Tooltip,
    Typography,
} from "@mui/material";
import { useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

type PowerFieldRow = {
    id: number;
    enterprise_name: string;
    subject_name: string;
    site_name: string;
    power_type: string;
    capacity: string;
    longitude: string;
    latitude: string;
    supplement: string;
    raw_address: string;
    standardized_address: string;
    province: string;
    city: string;
    district: string;
    town: string;
    village: string;
    group_name: string;
    confidence: number;
};

type RecognitionRow = {
    id: number;
    original_image: string;
    province_name: string;
    city: string;
    longitude: string;
    latitude: string;
    area?: string | null;
    capacity?: string | null;
    image_exists: number;
    image_url?: string | null;
};

type TableResponse<T> = {
    rows: T[];
    total: number;
};

type ImportState = {
    open: boolean;
    type: "power-fields" | "solar-recognition" | "wind-recognition" | null;
    file: File | null;
    progress: number;
    message: string;
    loading: boolean;
    error: string | null;
};

type ImageArchiveUploadState = {
    open: boolean;
    type: "solar" | "wind" | null;
    file: File | null;
    loading: boolean;
    message: string;
    error: string | null;
};

type ExcludeProvinceState = {
    open: boolean;
    province: string;
    type: "solar" | "wind" | null;
};

const pageSize = 10;
const compactFieldSx = {
    "& .MuiInputBase-root": {
        height: 40,
    },
    "& .MuiInputBase-input": {
        py: 1,
    },
};
const dialogFieldProps = {
    fullWidth: true,
    variant: "outlined" as const,
    sx: {
        "& .MuiInputBase-root": {
            minHeight: 56,
            alignItems: "center",
        },
    },
};

const defaultPowerFieldForm: Omit<PowerFieldRow, "id"> = {
    enterprise_name: "",
    subject_name: "",
    site_name: "",
    power_type: "",
    capacity: "",
    longitude: "",
    latitude: "",
    supplement: "",
    raw_address: "",
    standardized_address: "",
    province: "",
    city: "",
    district: "",
    town: "",
    village: "",
    group_name: "",
    confidence: 0.95,
};

const provinceOptions = [
    "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江",
    "上海", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南",
    "湖北", "湖南", "广东", "广西", "海南", "重庆", "四川", "贵州",
    "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆", "台湾",
    "香港", "澳门",
];

const powerTypeOptions = [
    "风电",
    "太阳能发电",
    "分布式光伏",
];

function confidenceLabel(value: number) {
    return `${Math.round((value || 0) * 100)}%`;
}

async function fetchJson<T>(input: RequestInfo, init?: RequestInit) {
    const response = await fetch(input, init);
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || "请求失败");
    }
    return payload as T;
}

function DataSectionCard(props: {
    title: string;
    children: React.ReactNode;
}) {
    return (
        <Card
            elevation={0}
            sx={{
                borderRadius: 5,
                border: "1px solid rgba(16, 74, 54, 0.1)",
                backgroundColor: "rgba(255, 255, 255, 0.88)",
            }}
        >
            <CardContent sx={{ p: 3.5 }}>
                <Stack spacing={3}>
                    <Box>
                        <Typography variant="h5" sx={{ fontWeight: 700 }}>
                            {props.title}
                        </Typography>
                    </Box>
                    {props.children}
                </Stack>
            </CardContent>
        </Card>
    );
}

export default function DataImportDashboard() {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const imageArchiveInputRef = useRef<HTMLInputElement | null>(null);
    const [powerRows, setPowerRows] = useState<PowerFieldRow[]>([]);
    const [powerTotal, setPowerTotal] = useState(0);
    const [powerPage, setPowerPage] = useState(0);
    const [powerFilters, setPowerFilters] = useState({
        keyword: "",
        powerType: "",
        confidenceLevel: "",
    });
    const [powerError, setPowerError] = useState<string | null>(null);
    const [powerDialogOpen, setPowerDialogOpen] = useState(false);
    const [editingPowerRow, setEditingPowerRow] = useState<PowerFieldRow | null>(null);
    const [powerForm, setPowerForm] = useState(defaultPowerFieldForm);

    const [solarRows, setSolarRows] = useState<RecognitionRow[]>([]);
    const [solarTotal, setSolarTotal] = useState(0);
    const [solarPage, setSolarPage] = useState(0);
    const [solarFilters, setSolarFilters] = useState({ province: "", unlinkedOnly: false });
    const [solarError, setSolarError] = useState<string | null>(null);

    const [windRows, setWindRows] = useState<RecognitionRow[]>([]);
    const [windTotal, setWindTotal] = useState(0);
    const [windPage, setWindPage] = useState(0);
    const [windFilters, setWindFilters] = useState({ province: "", unlinkedOnly: false });
    const [windError, setWindError] = useState<string | null>(null);

    const [confirmDialog, setConfirmDialog] = useState<{
        open: boolean;
        title: string;
        description: string;
        action: (() => Promise<void>) | null;
    }>({ open: false, title: "", description: "", action: null });

    const [importState, setImportState] = useState<ImportState>({
        open: false,
        type: null,
        file: null,
        progress: 0,
        message: "",
        loading: false,
        error: null,
    });
    const [imageArchiveUploadState, setImageArchiveUploadState] = useState<ImageArchiveUploadState>({
        open: false,
        type: null,
        file: null,
        loading: false,
        message: "",
        error: null,
    });
    const [excludeProvinceState, setExcludeProvinceState] = useState<ExcludeProvinceState>({
        open: false,
        province: "",
        type: null,
    });

    const solarExportHref = `/api/recognition?${new URLSearchParams({
        type: "solar",
        province: solarFilters.province,
        unlinkedOnly: String(solarFilters.unlinkedOnly),
        format: "csv",
    }).toString()}`;
    const powerExportHref = `/api/power-fields?${new URLSearchParams({
        keyword: powerFilters.keyword,
        powerType: powerFilters.powerType,
        confidenceLevel: powerFilters.confidenceLevel,
        format: "csv",
    }).toString()}`;
    const windExportHref = `/api/recognition?${new URLSearchParams({
        type: "wind",
        province: windFilters.province,
        unlinkedOnly: String(windFilters.unlinkedOnly),
        format: "csv",
    }).toString()}`;

    useEffect(() => {
        void loadPowerFields();
    }, [powerPage, powerFilters]);

    useEffect(() => {
        void loadRecognition("solar");
    }, [solarPage, solarFilters]);

    useEffect(() => {
        void loadRecognition("wind");
    }, [windPage, windFilters]);

    async function loadPowerFields() {
        try {
            setPowerError(null);
            const params = new URLSearchParams({
                page: String(powerPage + 1),
                pageSize: String(pageSize),
                keyword: powerFilters.keyword,
                powerType: powerFilters.powerType,
                confidenceLevel: powerFilters.confidenceLevel,
            });
            const payload = await fetchJson<{ ok: true } & TableResponse<PowerFieldRow>>(
                `/api/power-fields?${params.toString()}`,
            );
            setPowerRows(payload.rows);
            setPowerTotal(payload.total);
        } catch (error) {
            setPowerError(error instanceof Error ? error.message : "加载失败");
        }
    }

    async function loadRecognition(type: "solar" | "wind") {
        const filters = type === "solar" ? solarFilters : windFilters;
        const page = type === "solar" ? solarPage : windPage;
        const setRows = type === "solar" ? setSolarRows : setWindRows;
        const setTotal = type === "solar" ? setSolarTotal : setWindTotal;
        const setError = type === "solar" ? setSolarError : setWindError;

        try {
            setError(null);
            const params = new URLSearchParams({
                type,
                page: String(page + 1),
                pageSize: String(pageSize),
                province: filters.province,
                unlinkedOnly: String(filters.unlinkedOnly),
            });
            const payload = await fetchJson<{ ok: true } & TableResponse<RecognitionRow>>(
                `/api/recognition?${params.toString()}`,
            );
            setRows(payload.rows);
            setTotal(payload.total);
        } catch (error) {
            setError(error instanceof Error ? error.message : "加载失败");
        }
    }

    function openImportDialog(type: ImportState["type"]) {
        setImportState({
            open: true,
            type,
            file: null,
            progress: 0,
            message: "",
            loading: false,
            error: null,
        });
    }

    function openImageArchiveDialog(type: "solar" | "wind") {
        setImageArchiveUploadState({
            open: true,
            type,
            file: null,
            loading: false,
            message: "",
            error: null,
        });
    }

    async function startImport() {
        if (!importState.type || !importState.file) {
            setImportState((current) => ({ ...current, error: "请先选择导入文件" }));
            return;
        }

        const formData = new FormData();
        formData.append("type", importState.type);
        formData.append("file", importState.file);
        setImportState((current) => ({
            ...current,
            loading: true,
            progress: 0,
            message: "开始导入...",
            error: null,
        }));

        try {
            const startPayload = await fetchJson<{ ok: true; jobId: string }>(
                "/api/import/start",
                { method: "POST", body: formData },
            );

            let completed = false;
            while (!completed) {
                await new Promise((resolve) => setTimeout(resolve, 300));
                const statusPayload = await fetchJson<{
                    ok: true;
                    job: {
                        processed: number;
                        total: number;
                        status: "pending" | "running" | "completed" | "failed";
                        error: string | null;
                    };
                }>(`/api/import/status?id=${startPayload.jobId}`);

                const ratio =
                    statusPayload.job.total > 0
                        ? statusPayload.job.processed / statusPayload.job.total
                        : 1;
                setImportState((current) => ({
                    ...current,
                    progress: Math.round(ratio * 100),
                    message: `已导入 ${statusPayload.job.processed} / ${statusPayload.job.total} 行`,
                }));

                if (statusPayload.job.status === "completed") {
                    completed = true;
                    setImportState((current) => ({
                        ...current,
                        loading: false,
                        progress: 100,
                        message: `导入完成，共 ${statusPayload.job.total} 行`,
                    }));
                }
                if (statusPayload.job.status === "failed") {
                    throw new Error(statusPayload.job.error || "导入失败");
                }
            }

            await Promise.all([
                loadPowerFields(),
                loadRecognition("solar"),
                loadRecognition("wind"),
            ]);
        } catch (error) {
            setImportState((current) => ({
                ...current,
                loading: false,
                error: error instanceof Error ? error.message : "导入失败",
            }));
        }
    }

    async function uploadImageArchive() {
        if (!imageArchiveUploadState.type || !imageArchiveUploadState.file) {
            setImageArchiveUploadState((current) => ({
                ...current,
                error: "请先选择 ZIP 文件",
            }));
            return;
        }

        const uploadType = imageArchiveUploadState.type;
        const uploadFile = imageArchiveUploadState.file;
        const formData = new FormData();
        formData.append("type", uploadType);
        formData.append("file", uploadFile);

        setImageArchiveUploadState((current) => ({
            ...current,
            loading: true,
            error: null,
            message: "正在上传并解压图片...",
        }));

        try {
            const payload = await fetchJson<{ ok: true; copiedCount: number; message: string }>(
                "/api/recognition/archive",
                {
                    method: "POST",
                    body: formData,
                },
            );

            await loadRecognition(uploadType);
            setImageArchiveUploadState((current) => ({
                ...current,
                loading: false,
                message: payload.message,
            }));
        } catch (error) {
            setImageArchiveUploadState((current) => ({
                ...current,
                loading: false,
                error: error instanceof Error ? error.message : "图片上传失败",
            }));
        }
    }

    function openPowerEditor(row?: PowerFieldRow) {
        setEditingPowerRow(row ?? null);
        setPowerForm(
            row
                ? {
                      enterprise_name: row.enterprise_name,
                      subject_name: row.subject_name,
                      site_name: row.site_name,
                      power_type: row.power_type,
                      capacity: row.capacity,
                      longitude: row.longitude,
                      latitude: row.latitude,
                      supplement: row.supplement,
                      raw_address: row.raw_address,
                      standardized_address: row.standardized_address,
                      province: row.province,
                      city: row.city,
                      district: row.district,
                      town: row.town,
                      village: row.village,
                      group_name: row.group_name,
                      confidence: row.confidence,
                  }
                : defaultPowerFieldForm,
        );
        setPowerDialogOpen(true);
    }

    async function savePowerField() {
        const method = editingPowerRow ? "PUT" : "POST";
        await fetchJson("/api/power-fields", {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                ...(editingPowerRow ? { id: editingPowerRow.id } : {}),
                ...powerForm,
            }),
        });
        setPowerDialogOpen(false);
        await loadPowerFields();
    }

    function confirmAction(title: string, description: string, action: () => Promise<void>) {
        setConfirmDialog({ open: true, title, description, action });
    }

    async function deletePowerField(id: number) {
        await fetchJson("/api/power-fields", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "single", id }),
        });
        await loadPowerFields();
    }

    async function deletePowerFields(mode: "all" | "filtered") {
        await fetchJson("/api/power-fields", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode, ...powerFilters }),
        });
        setPowerPage(0);
        await loadPowerFields();
    }

    async function deleteRecognition(type: "solar" | "wind", id: number) {
        await fetchJson("/api/recognition", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "single", type, id }),
        });
        await loadRecognition(type);
    }

    async function deleteRecognitionBatch(type: "solar" | "wind", mode: "all" | "filtered") {
        const filters = type === "solar" ? solarFilters : windFilters;
        await fetchJson("/api/recognition", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode, type, ...filters }),
        });
        if (type === "solar") {
            setSolarPage(0);
        } else {
            setWindPage(0);
        }
        await loadRecognition(type);
    }

    async function cleanupRecognitionImages(type: "solar" | "wind") {
        await fetchJson("/api/recognition", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "cleanup-images", type }),
        });
        await loadRecognition(type);
    }

    async function excludeOutOfProvinceRecognitionData(type: "solar" | "wind") {
        const filters = type === "solar" ? solarFilters : windFilters;
        setExcludeProvinceState({
            open: true,
            province: filters.province,
            type,
        });
        try {
            await fetchJson("/api/recognition", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    mode: "exclude-out-of-province",
                    type,
                    province: filters.province,
                }),
            });
            if (type === "solar") {
                setSolarPage(0);
            } else {
                setWindPage(0);
            }
            await loadRecognition(type);
        } finally {
            setExcludeProvinceState({
                open: false,
                province: "",
                type: null,
            });
        }
    }

    return (
        <Stack spacing={3}>
            <DataSectionCard
                title="电场数据"
            >
                <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                    <TextField
                        label="省份 / 企业名"
                        size="small"
                        sx={{ minWidth: 240, ...compactFieldSx }}
                        value={powerFilters.keyword}
                        onChange={(event) => {
                            setPowerPage(0);
                            setPowerFilters((current) => ({
                                ...current,
                                keyword: event.target.value,
                            }));
                        }}
                    />
                    <FormControl size="small" sx={{ minWidth: 160, ...compactFieldSx }}>
                        <InputLabel>发电类型</InputLabel>
                        <Select
                            label="发电类型"
                            value={powerFilters.powerType}
                            onChange={(event) => {
                                setPowerPage(0);
                                setPowerFilters((current) => ({
                                    ...current,
                                    powerType: String(event.target.value),
                                }));
                            }}
                        >
                            <MenuItem value="">全部</MenuItem>
                            {powerTypeOptions.map((option) => (
                                <MenuItem key={option} value={option}>
                                    {option}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ minWidth: 160, ...compactFieldSx }}>
                        <InputLabel>可信度</InputLabel>
                        <Select
                            label="可信度"
                            value={powerFilters.confidenceLevel}
                            onChange={(event) => {
                                setPowerPage(0);
                                setPowerFilters((current) => ({
                                    ...current,
                                    confidenceLevel: String(event.target.value),
                                }));
                            }}
                        >
                            <MenuItem value="">全部</MenuItem>
                            <MenuItem value="high">准确 &gt; 90%</MenuItem>
                            <MenuItem value="medium">一般 80%</MenuItem>
                            <MenuItem value="low">不可信 &lt; 80%</MenuItem>
                        </Select>
                    </FormControl>
                    <Button
                        size="small"
                        variant="text"
                        onClick={() => {
                            setPowerPage(0);
                            setPowerFilters({
                                keyword: "",
                                powerType: "",
                                confidenceLevel: "",
                            });
                        }}
                    >
                        重置
                    </Button>
                    <Box sx={{ flexGrow: 1 }} />
                    <Button
                        size="small"
                        startIcon={<AddIcon />}
                        variant="contained"
                        onClick={() => openPowerEditor()}
                    >
                        手动新增
                    </Button>
                    <Button
                        size="small"
                        component="a"
                        href="/api/import/template?type=power-fields"
                        variant="text"
                    >
                        下载模板
                    </Button>
                    <Button
                        size="small"
                        component="a"
                        href={powerExportHref}
                        startIcon={<DownloadIcon />}
                        variant="text"
                    >
                        导出
                    </Button>
                    <Button
                        size="small"
                        startIcon={<CloudUploadIcon />}
                        variant="outlined"
                        onClick={() => openImportDialog("power-fields")}
                    >
                        导入
                    </Button>
                </Stack>
                <CardActions sx={{ px: 0 }}>
                    <Button
                        size="small"
                        color="error"
                        startIcon={<DeleteIcon />}
                        disabled={powerTotal === 0}
                        onClick={() =>
                            confirmAction("删除当前查询结果", "将根据当前筛选条件删除电场数据。", async () =>
                                deletePowerFields("filtered"),
                            )
                        }
                    >
                        删除当前查询结果
                    </Button>
                    <Button
                        size="small"
                        color="error"
                        startIcon={<DeleteIcon />}
                        disabled={powerTotal === 0}
                        onClick={() =>
                            confirmAction("删除全部电场数据", "将删除全部电场数据，且无法恢复。", async () =>
                                deletePowerFields("all"),
                            )
                        }
                    >
                        删除所有
                    </Button>
                </CardActions>
                {powerError ? <Alert severity="error">{powerError}</Alert> : null}
                <Box sx={{ overflowX: "auto" }}>
                    <Table size="small" sx={{ minWidth: 1600 }}>
                        <TableHead>
                            <TableRow>
                                <TableCell
                                    sx={{
                                        position: "sticky",
                                        left: 0,
                                        zIndex: 3,
                                        backgroundColor: "#fff",
                                        minWidth: 180,
                                    }}
                                >
                                    企业名称
                                </TableCell>
                                <TableCell>场站名</TableCell>
                                <TableCell>发电类型</TableCell>
                                <TableCell sx={{ minWidth: 110 }}>装机容量(MW)</TableCell>
                                <TableCell>经度</TableCell>
                                <TableCell>纬度</TableCell>
                                <TableCell>补充信息</TableCell>
                                <TableCell>原始地址片段</TableCell>
                                <TableCell>标准化地址</TableCell>
                                <TableCell>省</TableCell>
                                <TableCell>市</TableCell>
                                <TableCell>区</TableCell>
                                <TableCell>乡镇街道</TableCell>
                                <TableCell>村社区</TableCell>
                                <TableCell>组设</TableCell>
                                <TableCell>可信度</TableCell>
                                <TableCell
                                    sx={{
                                        position: "sticky",
                                        right: 0,
                                        zIndex: 3,
                                        backgroundColor: "#fff",
                                        minWidth: 150,
                                    }}
                                />
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {powerRows.map((row) => (
                                <TableRow key={row.id} hover>
                                    <TableCell
                                        sx={{
                                            position: "sticky",
                                            left: 0,
                                            zIndex: 2,
                                            backgroundColor: "#fff",
                                            minWidth: 180,
                                        }}
                                    >
                                        {row.enterprise_name}
                                    </TableCell>
                                    <TableCell>{row.site_name}</TableCell>
                                    <TableCell>{row.power_type}</TableCell>
                                    <TableCell sx={{ minWidth: 110 }}>{row.capacity}</TableCell>
                                    <TableCell>{row.longitude}</TableCell>
                                    <TableCell>{row.latitude}</TableCell>
                                    <TableCell>{row.supplement}</TableCell>
                                    <TableCell>{row.raw_address}</TableCell>
                                    <TableCell>{row.standardized_address}</TableCell>
                                    <TableCell>{row.province}</TableCell>
                                    <TableCell>{row.city}</TableCell>
                                    <TableCell>{row.district}</TableCell>
                                    <TableCell>{row.town}</TableCell>
                                    <TableCell>{row.village}</TableCell>
                                    <TableCell>{row.group_name}</TableCell>
                                    <TableCell>{confidenceLabel(row.confidence)}</TableCell>
                                    <TableCell
                                        sx={{
                                            position: "sticky",
                                            right: 0,
                                            zIndex: 2,
                                            backgroundColor: "#fff",
                                            minWidth: 150,
                                        }}
                                    >
                                        <Stack direction="row" spacing={1}>
                                            <Button
                                                size="small"
                                                startIcon={<EditIcon />}
                                                onClick={() => openPowerEditor(row)}
                                            >
                                                编辑
                                            </Button>
                                            <Button
                                                size="small"
                                                color="error"
                                                startIcon={<DeleteIcon />}
                                                onClick={() =>
                                                    confirmAction(
                                                        "删除电场数据",
                                                        `将删除 ${row.subject_name || row.enterprise_name}`,
                                                        async () => deletePowerField(row.id),
                                                    )
                                                }
                                            >
                                                删除
                                            </Button>
                                        </Stack>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </Box>
                <TablePagination
                    component="div"
                    count={powerTotal}
                    page={powerPage}
                    onPageChange={(_, page) => setPowerPage(page)}
                    rowsPerPage={pageSize}
                    rowsPerPageOptions={[10]}
                />
            </DataSectionCard>

            <RecognitionSection
                title="光伏识别数据"
                rows={solarRows}
                total={solarTotal}
                page={solarPage}
                setPage={setSolarPage}
                filters={solarFilters}
                setFilters={setSolarFilters}
                error={solarError}
                onImport={() => openImportDialog("solar-recognition")}
                onUploadImages={() => openImageArchiveDialog("solar")}
                exportHref={solarExportHref}
                onDeleteFiltered={() =>
                    confirmAction("删除当前光伏搜索结果", "将根据当前搜索条件删除光伏识别数据。", async () =>
                        deleteRecognitionBatch("solar", "filtered"),
                    )
                }
                onCleanupImages={() =>
                    confirmAction(
                        "删除未关联光伏图片",
                        "将删除光伏图片目录中所有文件名不在光伏识别数据库中的图片文件。",
                        async () => cleanupRecognitionImages("solar"),
                    )
                }
                onDeleteAll={() =>
                    confirmAction("删除全部光伏识别数据", "将删除全部光伏识别数据，且无法恢复。", async () =>
                        deleteRecognitionBatch("solar", "all"),
                    )
                }
                extraDangerActions={(
                    <Button
                        size="small"
                        color="warning"
                        startIcon={<DeleteIcon />}
                        disabled={!solarFilters.province || solarTotal === 0}
                        onClick={() =>
                            confirmAction(
                                "排除省外光伏数据",
                                `将检查当前所选省份“${solarFilters.province || ""}”的光伏坐标，并通过天地图接口删除不在该省内的数据。`,
                                async () => excludeOutOfProvinceRecognitionData("solar"),
                            )
                        }
                    >
                        排除省外数据
                    </Button>
                )}
                onDeleteRow={(id) =>
                    confirmAction("删除光伏识别数据", `将删除 ID=${id} 的光伏识别数据。`, async () =>
                        deleteRecognition("solar", id),
                    )
                }
            />

            <RecognitionSection
                title="风电识别数据"
                rows={windRows}
                total={windTotal}
                page={windPage}
                setPage={setWindPage}
                filters={windFilters}
                setFilters={setWindFilters}
                error={windError}
                onImport={() => openImportDialog("wind-recognition")}
                onUploadImages={() => openImageArchiveDialog("wind")}
                exportHref={windExportHref}
                onDeleteFiltered={() =>
                    confirmAction("删除当前风电搜索结果", "将根据当前搜索条件删除风电识别数据。", async () =>
                        deleteRecognitionBatch("wind", "filtered"),
                    )
                }
                onCleanupImages={() =>
                    confirmAction(
                        "删除未关联风电图片",
                        "将删除风电图片目录中所有文件名不在风电识别数据库中的图片文件。",
                        async () => cleanupRecognitionImages("wind"),
                    )
                }
                onDeleteAll={() =>
                    confirmAction("删除全部风电识别数据", "将删除全部风电识别数据，且无法恢复。", async () =>
                        deleteRecognitionBatch("wind", "all"),
                    )
                }
                extraDangerActions={(
                    <Button
                        size="small"
                        color="warning"
                        startIcon={<DeleteIcon />}
                        disabled={!windFilters.province || windTotal === 0}
                        onClick={() =>
                            confirmAction(
                                "排除省外风机数据",
                                `将检查当前所选省份“${windFilters.province || ""}”的风机坐标，并通过天地图接口删除不在该省内的数据。`,
                                async () => excludeOutOfProvinceRecognitionData("wind"),
                            )
                        }
                    >
                        排除省外数据
                    </Button>
                )}
                onDeleteRow={(id) =>
                    confirmAction("删除风电识别数据", `将删除 ID=${id} 的风电识别数据。`, async () =>
                        deleteRecognition("wind", id),
                    )
                }
            />

            <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                hidden
                onChange={(event) =>
                    setImportState((current) => ({
                        ...current,
                        file: event.target.files?.[0] ?? null,
                        error: null,
                    }))
                }
            />

            <input
                ref={imageArchiveInputRef}
                type="file"
                accept=".zip,application/zip"
                hidden
                onChange={(event) =>
                    setImageArchiveUploadState((current) => ({
                        ...current,
                        file: event.target.files?.[0] ?? null,
                        error: null,
                    }))
                }
            />

            <Dialog
                open={importState.open}
                onClose={importState.loading ? undefined : () => setImportState((current) => ({ ...current, open: false }))}
                fullWidth
                maxWidth="sm"
            >
                <DialogTitle>导入数据</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ pt: 1 }}>
                        <Button variant="outlined" onClick={() => fileInputRef.current?.click()}>
                            {importState.file ? importState.file.name : "选择 CSV 文件"}
                        </Button>
                        {importState.loading || importState.progress > 0 ? (
                            <Stack spacing={1}>
                                <LinearProgress variant="determinate" value={importState.progress} />
                                <Typography variant="body2" color="text.secondary">
                                    {importState.message}
                                </Typography>
                            </Stack>
                        ) : null}
                        {importState.error ? <Alert severity="error">{importState.error}</Alert> : null}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    {!importState.loading ? (
                        <Button onClick={() => setImportState((current) => ({ ...current, open: false }))}>
                            关闭
                        </Button>
                    ) : null}
                    <Button
                        variant="contained"
                        onClick={() => void startImport()}
                        disabled={importState.loading}
                    >
                        开始导入
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog open={powerDialogOpen} onClose={() => setPowerDialogOpen(false)} fullWidth maxWidth="md">
                <DialogTitle>{editingPowerRow ? "编辑电场数据" : "新增电场数据"}</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ pt: 1 }}>
                        <TextField {...dialogFieldProps} label="企业名称" value={powerForm.enterprise_name} onChange={(event) => setPowerForm((current) => ({ ...current, enterprise_name: event.target.value }))} />
                        <TextField {...dialogFieldProps} label="主体名称" value={powerForm.subject_name} onChange={(event) => setPowerForm((current) => ({ ...current, subject_name: event.target.value }))} />
                        <TextField {...dialogFieldProps} label="站点名称" value={powerForm.site_name} onChange={(event) => setPowerForm((current) => ({ ...current, site_name: event.target.value }))} />
                        <TextField {...dialogFieldProps} label="发电类型" value={powerForm.power_type} onChange={(event) => setPowerForm((current) => ({ ...current, power_type: event.target.value }))} />
                        <TextField {...dialogFieldProps} label="装机容量(MW)" value={powerForm.capacity} onChange={(event) => setPowerForm((current) => ({ ...current, capacity: event.target.value }))} />
                        <TextField {...dialogFieldProps} label="经度" value={powerForm.longitude} onChange={(event) => setPowerForm((current) => ({ ...current, longitude: event.target.value }))} />
                        <TextField {...dialogFieldProps} label="纬度" value={powerForm.latitude} onChange={(event) => setPowerForm((current) => ({ ...current, latitude: event.target.value }))} />
                        <TextField {...dialogFieldProps} label="补充信息" value={powerForm.supplement} onChange={(event) => setPowerForm((current) => ({ ...current, supplement: event.target.value }))} />
                        <TextField {...dialogFieldProps} label="原始地址片段" value={powerForm.raw_address} onChange={(event) => setPowerForm((current) => ({ ...current, raw_address: event.target.value }))} />
                        <TextField {...dialogFieldProps} label="标准化地址" value={powerForm.standardized_address} onChange={(event) => setPowerForm((current) => ({ ...current, standardized_address: event.target.value }))} />
                        <TextField {...dialogFieldProps} label="省" value={powerForm.province} onChange={(event) => setPowerForm((current) => ({ ...current, province: event.target.value }))} />
                        <TextField {...dialogFieldProps} label="市" value={powerForm.city} onChange={(event) => setPowerForm((current) => ({ ...current, city: event.target.value }))} />
                        <TextField {...dialogFieldProps} label="区" value={powerForm.district} onChange={(event) => setPowerForm((current) => ({ ...current, district: event.target.value }))} />
                        <TextField {...dialogFieldProps} label="乡镇街道" value={powerForm.town} onChange={(event) => setPowerForm((current) => ({ ...current, town: event.target.value }))} />
                        <TextField {...dialogFieldProps} label="村社区" value={powerForm.village} onChange={(event) => setPowerForm((current) => ({ ...current, village: event.target.value }))} />
                        <TextField {...dialogFieldProps} label="组设" value={powerForm.group_name} onChange={(event) => setPowerForm((current) => ({ ...current, group_name: event.target.value }))} />
                        <TextField {...dialogFieldProps} label="可信度" type="number" inputProps={{ step: 0.01, min: 0, max: 1 }} value={powerForm.confidence} onChange={(event) => setPowerForm((current) => ({ ...current, confidence: Number(event.target.value) }))} />
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setPowerDialogOpen(false)}>取消</Button>
                    <Button variant="contained" onClick={() => void savePowerField()}>
                        保存
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog
                open={imageArchiveUploadState.open}
                onClose={
                    imageArchiveUploadState.loading
                        ? undefined
                        : () => setImageArchiveUploadState((current) => ({ ...current, open: false }))
                }
                fullWidth
                maxWidth="sm"
            >
                <DialogTitle>上传识别图片 ZIP</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ pt: 1 }}>
                        <Button variant="outlined" onClick={() => imageArchiveInputRef.current?.click()}>
                            {imageArchiveUploadState.file ? imageArchiveUploadState.file.name : "选择 ZIP 文件"}
                        </Button>
                        {imageArchiveUploadState.message ? (
                            <Alert severity="success">{imageArchiveUploadState.message}</Alert>
                        ) : null}
                        {imageArchiveUploadState.error ? (
                            <Alert severity="error">{imageArchiveUploadState.error}</Alert>
                        ) : null}
                        <Typography variant="body2" color="text.secondary">
                            ZIP 会先解压到临时目录，再把图片复制到当前配置的识别图片目录，完成后自动清理临时文件。
                        </Typography>
                    </Stack>
                </DialogContent>
                <DialogActions>
                    {!imageArchiveUploadState.loading ? (
                        <Button
                            onClick={() =>
                                setImageArchiveUploadState((current) => ({ ...current, open: false }))
                            }
                        >
                            关闭
                        </Button>
                    ) : null}
                    <Button
                        variant="contained"
                        onClick={() => void uploadImageArchive()}
                        disabled={imageArchiveUploadState.loading}
                    >
                        {imageArchiveUploadState.loading ? "上传中..." : "开始上传"}
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog open={confirmDialog.open} onClose={() => setConfirmDialog((current) => ({ ...current, open: false }))}>
                <DialogTitle>{confirmDialog.title}</DialogTitle>
                <DialogContent>
                    <Typography>{confirmDialog.description}</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmDialog((current) => ({ ...current, open: false }))}>
                        取消
                    </Button>
                    <Button
                        color="error"
                        variant="contained"
                        onClick={async () => {
                            if (confirmDialog.action) {
                                await confirmDialog.action();
                            }
                            setConfirmDialog((current) => ({ ...current, open: false }));
                        }}
                    >
                        确认删除
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog open={excludeProvinceState.open} PaperProps={{ sx: { minWidth: 360 } }}>
                <DialogTitle>正在排除省外数据</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ pt: 1 }}>
                        <Typography variant="body2" color="text.secondary">
                            正在检查 {excludeProvinceState.province || "当前省份"} 的{excludeProvinceState.type === "solar" ? "光伏" : "风机"}坐标，并调用天地图接口删除省外记录，请稍候。
                        </Typography>
                        <LinearProgress />
                    </Stack>
                </DialogContent>
            </Dialog>
        </Stack>
    );
}

function RecognitionSection(props: {
    title: string;
    rows: RecognitionRow[];
    total: number;
    page: number;
    setPage: (value: number) => void;
    filters: { province: string; unlinkedOnly: boolean };
    setFilters: Dispatch<SetStateAction<{ province: string; unlinkedOnly: boolean }>>;
    error: string | null;
    onImport: () => void;
    onUploadImages: () => void;
    exportHref: string;
    onDeleteFiltered: () => void;
    onCleanupImages: () => void;
    onDeleteAll: () => void;
    onDeleteRow: (id: number) => void;
    extraDangerActions?: ReactNode;
}) {
    const templateType = props.title.includes("光伏") ? "solar-recognition" : "wind-recognition";
    const selectedProvince = props.filters.province || null;
    const isSolar = props.title.includes("光伏");

    return (
        <DataSectionCard title={props.title}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                <Autocomplete
                    options={provinceOptions}
                    size="small"
                    sx={{ minWidth: 180 }}
                    value={selectedProvince}
                    onChange={(_, value) => {
                        props.setPage(0);
                        props.setFilters((current) => ({
                            ...current,
                            province: value ?? "",
                        }));
                    }}
                    renderInput={(params) => (
                        <TextField
                            {...params}
                            label="省"
                            sx={compactFieldSx}
                        />
                    )}
                />
                <FormControlLabel
                    control={
                        <Checkbox
                            size="small"
                            checked={props.filters.unlinkedOnly}
                            onChange={(event) => {
                                props.setPage(0);
                                props.setFilters((current) => ({
                                    ...current,
                                    unlinkedOnly: event.target.checked,
                                }));
                            }}
                        />
                    }
                    label="未关联地图"
                />
                <Button
                    size="small"
                    variant="text"
                    onClick={() => {
                        props.setPage(0);
                        props.setFilters({ province: "", unlinkedOnly: false });
                    }}
                >
                    重置
                </Button>
                <Box sx={{ flexGrow: 1 }} />
                <Button
                    size="small"
                    component="a"
                    href={`/api/import/template?type=${templateType}`}
                    variant="text"
                >
                    下载模板
                </Button>
                <Button
                    size="small"
                    component="a"
                    href={props.exportHref}
                    startIcon={<DownloadIcon />}
                    variant="text"
                >
                    导出
                </Button>
                <Button size="small" variant="text" onClick={props.onUploadImages}>
                    上传图片 ZIP
                </Button>
                <Button size="small" startIcon={<CloudUploadIcon />} variant="outlined" onClick={props.onImport}>
                    导入
                </Button>
            </Stack>
            <CardActions sx={{ px: 0 }}>
                <Button
                    size="small"
                    color="error"
                    startIcon={<DeleteIcon />}
                    disabled={props.total === 0}
                    onClick={props.onDeleteFiltered}
                >
                    删除当前搜索结果
                </Button>
                <Button
                    size="small"
                    color="warning"
                    startIcon={<DeleteIcon />}
                    onClick={props.onCleanupImages}
                >
                    删除未关联图片
                </Button>
                <Button
                    size="small"
                    color="error"
                    startIcon={<DeleteIcon />}
                    disabled={props.total === 0}
                    onClick={props.onDeleteAll}
                >
                    删除所有
                </Button>
                {props.extraDangerActions}
            </CardActions>
            {props.error ? <Alert severity="error">{props.error}</Alert> : null}
            <Box sx={{ overflowX: "auto" }}>
                <Table size="small" sx={{ minWidth: isSolar ? 980 : 760, tableLayout: "fixed" }}>
                    <TableHead>
                        <TableRow>
                            <TableCell
                                sx={{
                                    position: "sticky",
                                    left: 0,
                                    zIndex: 3,
                                    backgroundColor: "#fff",
                                    width: 120,
                                    minWidth: 120,
                                    maxWidth: 120,
                                }}
                            >
                                省
                            </TableCell>
                            <TableCell sx={{ width: 120, minWidth: 120, maxWidth: 120 }}>市</TableCell>
                            <TableCell sx={{ width: 80, minWidth: 80, maxWidth: 80 }}>图片</TableCell>
                            <TableCell sx={{ width: 120, minWidth: 120, maxWidth: 120 }}>经度</TableCell>
                            <TableCell sx={{ width: 120, minWidth: 120, maxWidth: 120 }}>纬度</TableCell>
                            {isSolar ? (
                                <TableCell sx={{ width: 120, minWidth: 120, maxWidth: 120 }}>面积</TableCell>
                            ) : null}
                            {isSolar ? (
                                <TableCell sx={{ width: 120, minWidth: 120, maxWidth: 120 }}>容量</TableCell>
                            ) : null}
                            <TableCell
                                sx={{
                                    position: "sticky",
                                    right: 0,
                                    zIndex: 3,
                                    backgroundColor: "#fff",
                                    width: 100,
                                    minWidth: 100,
                                    maxWidth: 100,
                                }}
                            />
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {props.rows.map((row) => (
                            <TableRow key={row.id} hover>
                                <TableCell
                                    sx={{
                                        position: "sticky",
                                        left: 0,
                                        zIndex: 2,
                                        backgroundColor: "#fff",
                                        width: 120,
                                        minWidth: 120,
                                        maxWidth: 120,
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                    }}
                                >
                                    {row.province_name}
                                </TableCell>
                                <TableCell
                                    sx={{
                                        width: 120,
                                        minWidth: 120,
                                        maxWidth: 120,
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                    }}
                                >
                                    {row.city}
                                </TableCell>
                                <TableCell sx={{ width: 80, minWidth: 80, maxWidth: 80 }}>
                                    {row.image_url ? (
                                        <Tooltip
                                            placement="right"
                                            slotProps={{
                                                tooltip: {
                                                    sx: {
                                                        p: 0.5,
                                                        backgroundColor: "#fff",
                                                        border: "1px solid rgba(0,0,0,0.08)",
                                                        maxWidth: "none",
                                                    },
                                                },
                                            }}
                                            title={
                                                <Box
                                                    component="img"
                                                    src={row.image_url}
                                                    alt={row.original_image}
                                                    sx={{
                                                        display: "block",
                                                        maxWidth: "none",
                                                    }}
                                                />
                                            }
                                        >
                                            <Box
                                                component="img"
                                                src={row.image_url}
                                                alt={row.original_image}
                                                sx={{
                                                    width: 32,
                                                    height: 32,
                                                    objectFit: "cover",
                                                    borderRadius: 1,
                                                    border: "1px solid rgba(0,0,0,0.08)",
                                                    cursor: "zoom-in",
                                                }}
                                            />
                                        </Tooltip>
                                    ) : (
                                        "无"
                                    )}
                                </TableCell>
                                <TableCell
                                    sx={{
                                        width: 120,
                                        minWidth: 120,
                                        maxWidth: 120,
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                    }}
                                >
                                    {row.longitude}
                                </TableCell>
                                <TableCell
                                    sx={{
                                        width: 120,
                                        minWidth: 120,
                                        maxWidth: 120,
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                    }}
                                >
                                    {row.latitude}
                                </TableCell>
                                {isSolar ? (
                                    <TableCell
                                        sx={{
                                            width: 120,
                                            minWidth: 120,
                                            maxWidth: 120,
                                            whiteSpace: "nowrap",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                        }}
                                    >
                                        {row.area || "-"}
                                    </TableCell>
                                ) : null}
                                {isSolar ? (
                                    <TableCell
                                        sx={{
                                            width: 120,
                                            minWidth: 120,
                                            maxWidth: 120,
                                            whiteSpace: "nowrap",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                        }}
                                    >
                                        {row.capacity || "-"}
                                    </TableCell>
                                ) : null}
                                <TableCell
                                    sx={{
                                        position: "sticky",
                                        right: 0,
                                        zIndex: 2,
                                        backgroundColor: "#fff",
                                        width: 100,
                                        minWidth: 100,
                                        maxWidth: 100,
                                    }}
                                >
                                    <Button
                                        size="small"
                                        color="error"
                                        startIcon={<DeleteIcon />}
                                        onClick={() => props.onDeleteRow(row.id)}
                                    >
                                        删除
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </Box>
            <TablePagination
                component="div"
                count={props.total}
                page={props.page}
                onPageChange={(_, page) => props.setPage(page)}
                rowsPerPage={pageSize}
                rowsPerPageOptions={[10]}
            />
        </DataSectionCard>
    );
}
