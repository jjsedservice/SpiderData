"use client";

import RefreshIcon from "@mui/icons-material/Refresh";
import HighlightAltIcon from "@mui/icons-material/HighlightAlt";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import {
    Alert,
    Autocomplete,
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
        AMap?: any;
        _AMapSecurityConfig?: {
            securityJsCode?: string;
        };
    }
}

type EnergyType = "wind" | "solar";
type AssociationMode = "radius" | "poi";

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
    association_source: "auto" | "manual";
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

type ProvinceBoundary = {
    rings: BoundaryPoint[][];
    bounds: [number, number, number, number] | null;
};

function defaultRadiusByType(type: EnergyType) {
    return type === "wind" ? "50" : "20";
}

const amapKey = "3c2b3317bd1fd82708d2298085255cd5";
const amapSecurityJsCode = "f91884f9854e1876e7062f294ab42185";

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
    { name: "北京", adcode: "110000" },
    { name: "天津", adcode: "120000" },
    { name: "河北", adcode: "130000" },
    { name: "山西", adcode: "140000" },
    { name: "内蒙古", adcode: "150000" },
    { name: "辽宁", adcode: "210000" },
    { name: "吉林", adcode: "220000" },
    { name: "黑龙江", adcode: "230000" },
    { name: "上海", adcode: "310000" },
    { name: "江苏", adcode: "320000" },
    { name: "浙江", adcode: "330000" },
    { name: "安徽", adcode: "340000" },
    { name: "福建", adcode: "350000" },
    { name: "江西", adcode: "360000" },
    { name: "山东", adcode: "370000" },
    { name: "河南", adcode: "410000" },
    { name: "湖北", adcode: "420000" },
    { name: "湖南", adcode: "430000" },
    { name: "广东", adcode: "440000" },
    { name: "广西", adcode: "450000" },
    { name: "海南", adcode: "460000" },
    { name: "重庆", adcode: "500000" },
    { name: "四川", adcode: "510000" },
    { name: "贵州", adcode: "520000" },
    { name: "云南", adcode: "530000" },
    { name: "西藏", adcode: "540000" },
    { name: "陕西", adcode: "610000" },
    { name: "甘肃", adcode: "620000" },
    { name: "青海", adcode: "630000" },
    { name: "宁夏", adcode: "640000" },
    { name: "新疆", adcode: "650000" },
    { name: "台湾", adcode: "710000" },
    { name: "香港", adcode: "810000" },
    { name: "澳门", adcode: "820000" },
] as const;

const provinceCodeMap = Object.fromEntries(
    provinces.map((province) => [province.name, province.adcode]),
) as Record<string, string>;

const compactFieldSx = {
    "& .MuiInputBase-root": {
        height: 40,
    },
    "& .MuiInputBase-input": {
        py: 1,
    },
};

async function fetchJson<T>(input: RequestInfo, init?: RequestInit) {
    const response = await fetch(input, init);
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || "请求失败");
    }
    return payload as T;
}

function createFarmLabel(text: string) {
    return `
        <div style="
            padding: 4px 8px;
            border-radius: 10px;
            border: 1px solid rgba(15,61,46,0.16);
            background: rgba(255,255,255,0.92);
            color: #0f3d2e;
            font-size: 12px;
            line-height: 1.2;
            white-space: nowrap;
            box-shadow: 0 6px 18px rgba(15,61,46,0.08);
        ">${text}</div>
    `;
}

function createFarmMarkerContent(color: string) {
    return `
        <div style="width:24px;height:34px;">
            <svg width="24" height="34" viewBox="0 0 24 34" xmlns="http://www.w3.org/2000/svg">
                <path fill="${color}" d="M12 0C5.372 0 0 5.372 0 12c0 8.6 12 22 12 22s12-13.4 12-22C24 5.372 18.628 0 12 0z"/>
                <circle cx="12" cy="12" r="5" fill="#ffffff"/>
            </svg>
        </div>
    `;
}

function createLegendMarkerDataUri(color: string) {
    return `data:image/svg+xml;utf8,${encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="34" viewBox="0 0 24 34">
            <path fill="${color}" d="M12 0C5.372 0 0 5.372 0 12c0 8.6 12 22 12 22s12-13.4 12-22C24 5.372 18.628 0 12 0z"/>
            <circle cx="12" cy="12" r="5" fill="#ffffff"/>
        </svg>
    `)}`;
}

function createImageMarkerContent(imageUrl: string) {
    return `
        <div style="
            width:24px;
            height:24px;
            border-radius:6px;
            overflow:hidden;
            box-shadow:0 6px 14px rgba(15,61,46,0.16);
            border:1px solid rgba(255,255,255,0.9);
            background:#ffffff;
        ">
            <img src="${imageUrl}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;" />
        </div>
    `;
}

function createOutlierMarkerContent() {
    return `
        <div style="
            width:10px;
            height:10px;
            border-radius:50%;
            background:#64b5f6;
            border:1px solid rgba(255,255,255,0.9);
            box-shadow:0 4px 10px rgba(100,181,246,0.28);
        "></div>
    `;
}

function createOutlierCircle(item: OutlierPreview, isSelected: boolean) {
    const lng = Number(item.longitude);
    const lat = Number(item.latitude);

    return new window.AMap.Circle({
        center: [lng, lat],
        radius: 150,
        strokeColor: isSelected ? "#fb8c00" : "#64b5f6",
        strokeWeight: 1,
        strokeOpacity: 0.9,
        fillColor: isSelected ? "#ffcc80" : "#bbdefb",
        fillOpacity: 0.8,
    });
}

export default function AssociationWorkspace() {
    const mapRef = useRef<HTMLDivElement | null>(null);
    const mapInstanceRef = useRef<any>(null);
    const countryLayerRef = useRef<any>(null);
    const overlaysRef = useRef<any[]>([]);
    const previewRef = useRef<AssociationPreview | null>(null);
    const lastRenderedFarmIdRef = useRef<number | null>(null);
    const drawingPathRef = useRef<[number, number][]>([]);
    const isPointerDrawingRef = useRef(false);
    const selectionOverlayRef = useRef<any>(null);

    const [scriptReady, setScriptReady] = useState(false);
    const [canLoadMapScript, setCanLoadMapScript] = useState(false);
    const [preview, setPreview] = useState<AssociationPreview | null>(null);
    const [provinceBoundary, setProvinceBoundary] = useState<ProvinceBoundary | null>(null);
    const [selectedFarmId, setSelectedFarmId] = useState<number | null>(null);
    const [selectingOutliers, setSelectingOutliers] = useState(false);
    const [selectedOutlierIds, setSelectedOutlierIds] = useState<number[]>([]);
    const [pendingManualOutlierIds, setPendingManualOutlierIds] = useState<number[]>([]);
    const [savingManualAssociations, setSavingManualAssociations] = useState(false);
    const [deletingManualAssociationId, setDeletingManualAssociationId] = useState<number | null>(null);
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
    const [drawingPixels, setDrawingPixels] = useState<Array<{ x: number; y: number }>>([]);
    const [filters, setFilters] = useState({
        type: "wind" as EnergyType,
        mode: "radius" as AssociationMode,
        radiusKm: defaultRadiusByType("wind"),
        province: "云南",
    });

    const selectedProvince =
        provinces.find((province) => province.name === filters.province) ?? null;
    const summary = preview?.summary ?? emptyPreview.summary;
    const radiusMeters =
        Math.max(Number(filters.radiusKm) || Number(defaultRadiusByType(filters.type)), 0.1) * 1000;
    const selectedFarm = useMemo(
        () => preview?.farms.find((farm) => farm.id === selectedFarmId) ?? null,
        [preview, selectedFarmId],
    );
    const selectedOutliers = useMemo(
        () =>
            (preview?.outliers ?? []).filter((item) => selectedOutlierIds.includes(item.id)),
        [preview, selectedOutlierIds],
    );
    const pendingManualOutliers = useMemo(
        () =>
            (preview?.outliers ?? []).filter((item) => pendingManualOutlierIds.includes(item.id)),
        [preview, pendingManualOutlierIds],
    );
    const autoAssociated = useMemo(
        () => selectedFarm?.associated.filter((item) => item.association_source === "auto") ?? [],
        [selectedFarm],
    );
    const manualAssociated = useMemo(
        () => selectedFarm?.associated.filter((item) => item.association_source === "manual") ?? [],
        [selectedFarm],
    );
    const mergedManualAssociated = useMemo(
        () =>
            Array.from(
                new Map(
                    [...manualAssociated, ...pendingManualOutliers].map((item) => [item.id, item]),
                ).values(),
            ),
        [manualAssociated, pendingManualOutliers],
    );

    useEffect(() => {
        previewRef.current = preview;
    }, [preview]);

    useEffect(() => {
        window._AMapSecurityConfig = {
            securityJsCode: amapSecurityJsCode,
        };
        setCanLoadMapScript(true);
    }, []);

    useEffect(() => {
        if (window.AMap) {
            setScriptReady(true);
        }
    }, [canLoadMapScript]);

    useEffect(() => {
        if (!scriptReady || !mapRef.current || mapInstanceRef.current || !window.AMap) {
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
            countryLayerRef.current = countryLayer;
        }

    }, [scriptReady]);

    useEffect(() => {
        if (!scriptReady) {
            return;
        }
        void loadPreview();
    }, [scriptReady, filters]);

    useEffect(() => {
        if (!scriptReady) {
            return;
        }
        void loadProvinceBoundary(filters.province);
    }, [scriptReady, filters.province]);

    useEffect(() => {
        if (!mapInstanceRef.current || !preview) {
            return;
        }

        const preserveViewport =
            selectedFarmId !== null &&
            lastRenderedFarmIdRef.current === selectedFarmId;

        renderMap(preserveViewport);
        lastRenderedFarmIdRef.current = selectedFarmId;
    }, [preview, provinceBoundary, selectedFarmId, pendingManualOutlierIds, selectedOutlierIds]);

    useEffect(() => {
        if (!selectedFarmId) {
            setSelectedOutlierIds([]);
            setPendingManualOutlierIds([]);
            setSelectingOutliers(false);
            clearSelectionArtifacts();
        }
    }, [selectedFarmId]);

    function clearSelectionArtifacts() {
        selectionOverlayRef.current?.setMap?.(null);
        selectionOverlayRef.current = null;
        drawingPathRef.current = [];
        isPointerDrawingRef.current = false;
        setDrawingPixels([]);
    }

    function getPointerData(clientX: number, clientY: number) {
        const map = mapInstanceRef.current;
        const container = mapRef.current;
        if (!map || !container || !window.AMap) {
            return null;
        }

        const rect = container.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        const lngLat = map.containerToLngLat(new window.AMap.Pixel(x, y));
        if (!lngLat) {
            return null;
        }

        return {
            x,
            y,
            lng: Number(lngLat.lng ?? lngLat.getLng?.()),
            lat: Number(lngLat.lat ?? lngLat.getLat?.()),
        };
    }

    function finishFreehandSelection() {
        const map = mapInstanceRef.current;
        if (!map || !isPointerDrawingRef.current) {
            return;
        }

        isPointerDrawingRef.current = false;
        map.setStatus?.({ dragEnable: true });

        if (drawingPathRef.current.length < 3) {
            clearSelectionArtifacts();
            setSelectingOutliers(false);
            return;
        }

        const polygonPoints = [...drawingPathRef.current];
        selectionOverlayRef.current?.setMap?.(null);
        const polygon = new window.AMap.Polygon({
            path: polygonPoints,
            strokeColor: "#1565c0",
            strokeOpacity: 0.95,
            strokeWeight: 2,
            fillColor: "#90caf9",
            fillOpacity: 0.18,
            zIndex: 19,
        });
        polygon.setMap(map);
        overlaysRef.current.push(polygon);
        selectionOverlayRef.current = polygon;

        const nextSelectedIds = (previewRef.current?.outliers ?? [])
            .filter((item) =>
                pointInPolygon(
                    [Number(item.longitude), Number(item.latitude)],
                    polygonPoints,
                ),
            )
            .map((item) => item.id);

        drawingPathRef.current = [];
        setDrawingPixels([]);
        setSelectedOutlierIds(nextSelectedIds);
        setSelectingOutliers(false);
    }

    function handleBrushPointerDown(event: any) {
        if (!selectingOutliers) {
            return;
        }

        const pointerData = getPointerData(event.clientX, event.clientY);
        if (!pointerData) {
            return;
        }

        selectionOverlayRef.current?.setMap?.(null);
        selectionOverlayRef.current = null;
        setSelectedOutlierIds([]);
        event.currentTarget.setPointerCapture(event.pointerId);
        mapInstanceRef.current?.setStatus?.({ dragEnable: false });
        isPointerDrawingRef.current = true;
        drawingPathRef.current = [[pointerData.lng, pointerData.lat]];
        setDrawingPixels([{ x: pointerData.x, y: pointerData.y }]);
    }

    function handleBrushPointerMove(event: any) {
        if (!selectingOutliers || !isPointerDrawingRef.current) {
            return;
        }

        const pointerData = getPointerData(event.clientX, event.clientY);
        if (!pointerData) {
            return;
        }

        drawingPathRef.current.push([pointerData.lng, pointerData.lat]);
        setDrawingPixels((current) => [...current, { x: pointerData.x, y: pointerData.y }]);
    }

    function handleBrushPointerUp(event: any) {
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        finishFreehandSelection();
    }

    async function loadPreview(nextSelectedFarmId?: number | null) {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({
                type: filters.type,
                mode: filters.mode,
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
            setSelectedFarmId(nextSelectedFarmId ?? null);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "加载失败");
        } finally {
            setLoading(false);
        }
    }

    async function loadProvinceBoundary(province: string) {
        const adcode = provinceCodeMap[province];
        if (!adcode) {
            setProvinceBoundary(null);
            return;
        }

        try {
            const response = await fetch(`https://geo.datav.aliyun.com/areas_v3/bound/${adcode}.json`);
            const payload = await response.json();
            const rings: BoundaryPoint[][] = [];

            for (const feature of payload.features ?? []) {
                const geometry = feature.geometry;
                if (geometry?.type === "Polygon") {
                    const [outerRing] = geometry.coordinates ?? [];
                    if (outerRing?.length) {
                        rings.push(
                            outerRing.map(([lng, lat]: [number, number]) => ({ lng, lat })),
                        );
                    }
                }
                if (geometry?.type === "MultiPolygon") {
                    for (const polygon of geometry.coordinates ?? []) {
                        const [outerRing] = polygon;
                        if (outerRing?.length) {
                            rings.push(
                                outerRing.map(([lng, lat]: [number, number]) => ({ lng, lat })),
                            );
                        }
                    }
                }
            }

            const allPoints = rings.flat();
            if (!allPoints.length) {
                setProvinceBoundary(null);
                return;
            }

            setProvinceBoundary({
                rings,
                bounds: [
                    Math.min(...allPoints.map((point) => point.lng)),
                    Math.min(...allPoints.map((point) => point.lat)),
                    Math.max(...allPoints.map((point) => point.lng)),
                    Math.max(...allPoints.map((point) => point.lat)),
                ],
            });
        } catch {
            setProvinceBoundary(null);
        }
    }

    function attachSelectedOutliers() {
        if (!selectedOutlierIds.length) {
            return;
        }

        setPendingManualOutlierIds((current) =>
            Array.from(new Set([...current, ...selectedOutlierIds])),
        );
        setSelectedOutlierIds([]);
        setSelectingOutliers(false);
        clearSelectionArtifacts();
        mapInstanceRef.current?.setStatus?.({ dragEnable: true });
    }

    function cancelSelectedOutliers() {
        setSelectedOutlierIds([]);
        setSelectingOutliers(false);
        clearSelectionArtifacts();
        mapInstanceRef.current?.setStatus?.({ dragEnable: true });
    }

    async function saveManualAssociations() {
        if (!selectedFarmId || !pendingManualOutlierIds.length) {
            return;
        }

        setSavingManualAssociations(true);
        setError(null);
        try {
            await fetchJson<{ ok: true }>("/api/association/manual", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    type: filters.type,
                    farmId: selectedFarmId,
                    recognitionIds: pendingManualOutlierIds,
                }),
            });
            setPendingManualOutlierIds([]);
            await loadPreview(selectedFarmId);
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : "保存附加关联失败");
        } finally {
            setSavingManualAssociations(false);
        }
    }

    async function removeManualAssociation(recognitionId: number) {
        if (!selectedFarmId) {
            return;
        }

        if (pendingManualOutlierIds.includes(recognitionId)) {
            setPendingManualOutlierIds((current) => current.filter((item) => item !== recognitionId));
            return;
        }

        setDeletingManualAssociationId(recognitionId);
        setError(null);
        try {
            await fetchJson<{ ok: true }>("/api/association/manual", {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    type: filters.type,
                    farmId: selectedFarmId,
                    recognitionId,
                }),
            });
            await loadPreview(selectedFarmId);
        } catch (deleteError) {
            setError(deleteError instanceof Error ? deleteError.message : "删除附加关联失败");
        } finally {
            setDeletingManualAssociationId(null);
        }
    }

    async function removeAllManualAssociations() {
        if (!selectedFarmId || !mergedManualAssociated.length) {
            return;
        }

        const pendingIds = pendingManualOutlierIds;
        const savedIds = manualAssociated.map((item) => item.id);

        if (pendingIds.length) {
            setPendingManualOutlierIds([]);
        }

        if (!savedIds.length) {
            return;
        }

        setDeletingManualAssociationId(-1);
        setError(null);
        try {
            await fetchJson<{ ok: true }>("/api/association/manual", {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    type: filters.type,
                    farmId: selectedFarmId,
                    recognitionIds: savedIds,
                }),
            });
            await loadPreview(selectedFarmId);
        } catch (deleteError) {
            setError(deleteError instanceof Error ? deleteError.message : "删除全部附加关联失败");
        } finally {
            setDeletingManualAssociationId(null);
        }
    }

    function clearMapOverlays() {
        setHoverPreview(null);
        overlaysRef.current.forEach((overlay) => overlay.setMap?.(null));
        overlaysRef.current = [];
        selectionOverlayRef.current = null;
    }

    function addOverlay(overlay: any) {
        overlay.setMap?.(mapInstanceRef.current);
        overlaysRef.current.push(overlay);
    }

    function updateHoverPreview(imageUrl: string, originalImage: string, lng: number, lat: number) {
        const map = mapInstanceRef.current;
        const container = mapRef.current;
        if (!map || !container) {
            return;
        }

        const pixel = map.lngLatToContainer([lng, lat]);
        const width = container.clientWidth;
        const height = container.clientHeight;
        const x = typeof pixel?.x === "number" ? pixel.x : width / 2;
        const y = typeof pixel?.y === "number" ? pixel.y : height / 2;

        setHoverPreview({
            imageUrl,
            originalImage,
            x,
            y,
            alignRight: x > width - 280,
            alignBottom: y > height - 280,
        });
    }

    function createRecognitionMarker(item: AssociatedRecognition) {
        const lng = Number(item.longitude);
        const lat = Number(item.latitude);

        if (!item.image_url) {
            return new window.AMap.Marker({
                position: [lng, lat],
            });
        }

        const marker = new window.AMap.Marker({
            position: [lng, lat],
            anchor: "center",
            content: createImageMarkerContent(item.image_url),
        });

        marker.on("mouseover", () => {
            updateHoverPreview(item.image_url!, item.original_image, lng, lat);
        });
        marker.on("mousemove", () => {
            updateHoverPreview(item.image_url!, item.original_image, lng, lat);
        });
        marker.on("mouseout", () => {
            setHoverPreview(null);
        });

        return marker;
    }

    function createOutlierMarker(item: OutlierPreview) {
        const lng = Number(item.longitude);
        const lat = Number(item.latitude);
        const isSelected = selectedOutlierIds.includes(item.id);
        const marker = new window.AMap.Marker({
            position: [lng, lat],
            anchor: "center",
            content: `
                <div style="
                    width:10px;
                    height:10px;
                    border-radius:50%;
                    background:${isSelected ? "#ff9800" : "#64b5f6"};
                    border:1px solid rgba(255,255,255,0.9);
                    box-shadow:0 4px 10px rgba(100,181,246,0.28);
                "></div>
            `,
        });

        if (item.image_url) {
            marker.on("mouseover", () => {
                updateHoverPreview(item.image_url!, item.original_image, lng, lat);
            });
            marker.on("mousemove", () => {
                updateHoverPreview(item.image_url!, item.original_image, lng, lat);
            });
            marker.on("mouseout", () => {
                setHoverPreview(null);
            });
        }

        return marker;
    }

    function pointInPolygon(point: [number, number], polygon: [number, number][]) {
        if (polygon.length < 3) {
            return false;
        }

        let inside = false;
        const [x, y] = point;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const [xi, yi] = polygon[i];
            const [xj, yj] = polygon[j];
            const intersect =
                yi > y !== yj > y &&
                x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi;
            if (intersect) {
                inside = !inside;
            }
        }
        return inside;
    }

    function renderProvinceOutline() {
        const map = mapInstanceRef.current;
        if (!map || !provinceBoundary?.rings.length) {
            return;
        }

        provinceBoundary.rings.forEach((ring) => {
            const polyline = new window.AMap.Polyline({
                path: ring.map((point) => [point.lng, point.lat]),
                strokeColor: "#1565c0",
                strokeWeight: 3,
                strokeOpacity: 0.95,
                strokeStyle: "solid",
                fillOpacity: 0,
                bubble: true,
            });
            addOverlay(polyline);
        });
    }

    function renderOverviewMap() {
        const map = mapInstanceRef.current;
        if (!map || !preview) {
            return;
        }

        const fitItems: any[] = [];
        renderProvinceOutline();

        preview.farms.forEach((farm) => {
            const marker = new window.AMap.Marker({
                position: [farm.longitude, farm.latitude],
                anchor: "bottom-center",
                content: createFarmMarkerContent(farm.associated_count === 0 ? "#d32f2f" : "#0f5c43"),
            });
            marker.on("click", () => setSelectedFarmId(farm.id));
            addOverlay(marker);
            fitItems.push(marker);

            const label = new window.AMap.Marker({
                position: [farm.longitude, farm.latitude],
                anchor: "bottom-center",
                offset: new window.AMap.Pixel(0, -44),
                content: createFarmLabel(`${farm.site_name || farm.enterprise_name} (${farm.associated_count})`),
            });
            addOverlay(label);
        });

        if (fitItems.length) {
            map.setFitView(fitItems, false, [40, 40, 40, 40], 8);
        }

        preview.outliers.forEach((item) => {
            const circle = new window.AMap.Circle({
                center: [Number(item.longitude), Number(item.latitude)],
                radius: 150,
                strokeColor: "#64b5f6",
                strokeWeight: 1,
                strokeOpacity: 0.9,
                fillColor: "#bbdefb",
                fillOpacity: 0.75,
            });
            addOverlay(circle);
        });
    }

    function renderFarmDetailMap(farm: FarmPreview, preserveViewport = false) {
        const map = mapInstanceRef.current;
        if (!map) {
            return;
        }
        const pendingManualSet = new Set(pendingManualOutlierIds);
        const pendingManualItems = (preview?.outliers ?? []).filter((item) =>
            pendingManualSet.has(item.id),
        );

        renderProvinceOutline();

        const farmMarker = new window.AMap.Marker({
            position: [farm.longitude, farm.latitude],
            anchor: "bottom-center",
            content: createFarmMarkerContent("#0f5c43"),
        });
        addOverlay(farmMarker);

        const fitItems: any[] = [farmMarker];
        const radiusCircle = new window.AMap.Circle({
            center: [farm.longitude, farm.latitude],
            radius: radiusMeters,
            strokeColor: "#1565c0",
            strokeWeight: 1,
            strokeOpacity: 0.85,
            strokeStyle: "dashed",
            fillColor: "#90caf9",
            fillOpacity: 0.08,
        });
        addOverlay(radiusCircle);
        fitItems.push(radiusCircle);

        farm.associated.forEach((item) => {
            const marker = createRecognitionMarker(item);
            addOverlay(marker);
            fitItems.push(marker);
        });
        pendingManualItems.forEach((item) => {
            const marker = createRecognitionMarker({
                id: item.id,
                original_image: item.original_image,
                longitude: item.longitude,
                latitude: item.latitude,
                image_url: item.image_url,
                distance_km: 0,
                association_source: "manual",
            });
            addOverlay(marker);
            fitItems.push(marker);
        });

        if (farm.boundary.length >= 3) {
            const polygon = new window.AMap.Polygon({
                path: farm.boundary.map((point) => [point.lng, point.lat]),
                strokeColor: "#1565c0",
                strokeWeight: 2,
                strokeOpacity: 0.9,
                fillColor: "#90caf9",
                fillOpacity: 0.18,
            });
            addOverlay(polygon);
            fitItems.push(polygon);
        }

        if (!preserveViewport && fitItems.length) {
            map.setFitView(fitItems, false, [60, 60, 60, 60], 11);
        }
        if (!preserveViewport) {
            map.setCenter([farm.longitude, farm.latitude]);
            map.setZoom(11);
        }

        const bounds = map.getBounds?.();
        preview?.outliers.forEach((item) => {
            if (pendingManualSet.has(item.id)) {
                return;
            }
            const lng = Number(item.longitude);
            const lat = Number(item.latitude);
            const isVisible = bounds?.contains?.([lng, lat]) ?? true;
            if (!isVisible) {
                return;
            }
            const circle = createOutlierCircle(item, selectedOutlierIds.includes(item.id));
            if (item.image_url) {
                circle.on("mouseover", () => {
                    updateHoverPreview(item.image_url!, item.original_image, lng, lat);
                });
                circle.on("mousemove", () => {
                    updateHoverPreview(item.image_url!, item.original_image, lng, lat);
                });
                circle.on("mouseout", () => {
                    setHoverPreview(null);
                });
            }
            addOverlay(circle);
        });
    }

    function renderMap(preserveViewport = false) {
        clearMapOverlays();
        if (selectedFarm) {
            renderFarmDetailMap(selectedFarm, preserveViewport);
            return;
        }
        renderOverviewMap();
    }

    return (
        <>
            {canLoadMapScript ? (
                <Script
                    src={`https://webapi.amap.com/maps?v=2.0&key=${amapKey}&plugin=AMap.DistrictLayer`}
                    strategy="afterInteractive"
                    onLoad={() => setScriptReady(true)}
                    onReady={() => setScriptReady(true)}
                />
            ) : null}

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
                                            radiusKm: defaultRadiusByType(event.target.value as EnergyType),
                                        }))
                                    }
                                >
                                    <MenuItem value="wind">风电</MenuItem>
                                    <MenuItem value="solar">光伏</MenuItem>
                                </TextField>
                                <TextField
                                    select
                                    label="关联方式"
                                    size="small"
                                    sx={{ minWidth: 160, ...compactFieldSx }}
                                    value={filters.mode}
                                    onChange={(event) =>
                                        setFilters((current) => ({
                                            ...current,
                                            mode: event.target.value as AssociationMode,
                                        }))
                                    }
                                >
                                    <MenuItem value="radius">半径关联</MenuItem>
                                    <MenuItem value="poi">位子信息关联</MenuItem>
                                </TextField>
                                <TextField
                                    label="关联半径(km)"
                                    size="small"
                                    sx={{ minWidth: 150, ...compactFieldSx }}
                                    value={filters.radiusKm}
                                    disabled={filters.mode === "poi"}
                                    onChange={(event) =>
                                        setFilters((current) => ({
                                            ...current,
                                            radiusKm: event.target.value,
                                        }))
                                    }
                                />
                                <Autocomplete
                                    options={provinces}
                                    size="small"
                                    sx={{ minWidth: 180 }}
                                    value={selectedProvince}
                                    getOptionLabel={(option) => option.name}
                                    isOptionEqualToValue={(option, value) => option.adcode === value.adcode}
                                    onChange={(_, value) => {
                                        if (!value) {
                                            return;
                                        }
                                        setFilters((current) => ({
                                            ...current,
                                            province: value.name,
                                        }));
                                    }}
                                    renderInput={(params) => (
                                        <TextField {...params} label="省份" sx={compactFieldSx} />
                                    )}
                                />
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
                            {selectedFarm && selectingOutliers ? (
                                <Box
                                    onPointerDown={handleBrushPointerDown}
                                    onPointerMove={handleBrushPointerMove}
                                    onPointerUp={handleBrushPointerUp}
                                    onPointerLeave={handleBrushPointerUp}
                                    sx={{
                                        position: "absolute",
                                        inset: 0,
                                        zIndex: 5,
                                        cursor: "crosshair",
                                        touchAction: "none",
                                    }}
                                >
                                    <Box
                                        component="svg"
                                        viewBox={`0 0 ${mapRef.current?.clientWidth ?? 1} ${mapRef.current?.clientHeight ?? 1}`}
                                        preserveAspectRatio="none"
                                        sx={{
                                            width: "100%",
                                            height: "100%",
                                            overflow: "visible",
                                        }}
                                    >
                                        {drawingPixels.length >= 2 ? (
                                            <polyline
                                                points={drawingPixels.map((point) => `${point.x},${point.y}`).join(" ")}
                                                fill="none"
                                                stroke="#1565c0"
                                                strokeWidth="2.5"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                            />
                                        ) : null}
                                    </Box>
                                </Box>
                            ) : null}
                            <Box
                                sx={{
                                    position: "absolute",
                                    top: 16,
                                    left: 16,
                                    zIndex: 6,
                                    px: 1.25,
                                    py: 1,
                                    borderRadius: 2,
                                    backgroundColor: "rgba(255,255,255,0.94)",
                                    border: "1px solid rgba(15, 61, 46, 0.12)",
                                    boxShadow: "0 10px 24px rgba(15, 61, 46, 0.12)",
                                }}
                            >
                                <Stack direction="row" spacing={2} alignItems="center">
                                    <Stack direction="row" spacing={1} alignItems="center">
                                        <Box
                                            component="img"
                                            src={createLegendMarkerDataUri("#d32f2f")}
                                            alt="未关联"
                                            sx={{ width: 12, height: 17, display: "block", ml: "-1px" }}
                                        />
                                        <Typography variant="body2" color="text.secondary">
                                            未关联
                                        </Typography>
                                    </Stack>
                                    <Stack direction="row" spacing={1} alignItems="center">
                                        <Box
                                            component="img"
                                            src={createLegendMarkerDataUri("#0f5c43")}
                                            alt="已关联"
                                            sx={{ width: 12, height: 17, display: "block", ml: "-1px" }}
                                        />
                                        <Typography variant="body2" color="text.secondary">
                                            已关联
                                        </Typography>
                                    </Stack>
                                    <Stack direction="row" spacing={1} alignItems="center">
                                        <Box
                                            sx={{
                                                width: 9,
                                                height: 9,
                                                borderRadius: "50%",
                                                backgroundColor: "#64b5f6",
                                            }}
                                        />
                                        <Typography variant="body2" color="text.secondary">
                                            {selectedFarm ? "零星（可悬停查看）" : "零星"}
                                        </Typography>
                                    </Stack>
                                    {selectedFarm ? (
                                        <Stack direction="row" spacing={1} alignItems="center">
                                            <Typography variant="body2" color="text.secondary">
                                                已圈选 {selectedOutlierIds.length} 个零星
                                            </Typography>
                                            <Button
                                                size="small"
                                                variant="contained"
                                                onClick={attachSelectedOutliers}
                                                sx={{
                                                    minWidth: 0,
                                                    px: 1.25,
                                                    height: 28,
                                                    borderRadius: 1.5,
                                                    display: selectedOutlierIds.length ? "inline-flex" : "none",
                                                }}
                                            >
                                                关联
                                            </Button>
                                            <Button
                                                size="small"
                                                variant="outlined"
                                                onClick={cancelSelectedOutliers}
                                                sx={{
                                                    minWidth: 0,
                                                    px: 1.25,
                                                    height: 28,
                                                    borderRadius: 1.5,
                                                    display: selectedOutlierIds.length ? "inline-flex" : "none",
                                                }}
                                            >
                                                取消
                                            </Button>
                                        </Stack>
                                    ) : null}
                                </Stack>
                            </Box>
                            {selectedFarm ? (
                                <Box
                                    sx={{
                                        position: "absolute",
                                        top: 16,
                                        right: 16,
                                        zIndex: 6,
                                    }}
                                >
                                    <Stack spacing={1.25} alignItems="stretch">
                                        <Button
                                            size="small"
                                            variant={selectingOutliers ? "contained" : "outlined"}
                                            startIcon={<HighlightAltIcon sx={{ fontSize: 16 }} />}
                                            onClick={() => {
                                                if (selectingOutliers) {
                                                    cancelSelectedOutliers();
                                                    return;
                                                }
                                                clearSelectionArtifacts();
                                                setSelectedOutlierIds([]);
                                                setSelectingOutliers(true);
                                            }}
                                            sx={{
                                                minWidth: 0,
                                                px: 1.5,
                                                height: 36,
                                                borderRadius: 2,
                                                backgroundColor: selectingOutliers ? "#1565c0" : "rgba(255,255,255,0.94)",
                                                color: selectingOutliers ? "#fff" : "#163c2f",
                                                borderColor: "rgba(15, 61, 46, 0.12)",
                                                boxShadow: "0 10px 24px rgba(15, 61, 46, 0.12)",
                                            }}
                                        >
                                            {selectingOutliers ? "结束圈选" : "圈选零星"}
                                        </Button>
                                        <Button
                                            size="small"
                                            variant="outlined"
                                            startIcon={<ArrowBackIcon sx={{ fontSize: 16 }} />}
                                            onClick={() => setSelectedFarmId(null)}
                                            sx={{
                                                minWidth: 0,
                                                px: 1.5,
                                                height: 36,
                                                borderRadius: 2,
                                                backgroundColor: "rgba(255,255,255,0.94)",
                                                color: "#163c2f",
                                                borderColor: "rgba(15, 61, 46, 0.12)",
                                                boxShadow: "0 10px 24px rgba(15, 61, 46, 0.12)",
                                            }}
                                        >
                                            返回总览
                                        </Button>
                                    </Stack>
                                </Box>
                            ) : null}
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
                                <Stack
                                    direction={{ xs: "column", md: "row" }}
                                    justifyContent="space-between"
                                    spacing={1.5}
                                    alignItems={{ xs: "flex-start", md: "center" }}
                                >
                                    <Typography variant="h5" sx={{ fontWeight: 700 }}>
                                        {selectedFarm.site_name || selectedFarm.enterprise_name}
                                    </Typography>
                                </Stack>
                                <Typography color="text.secondary">
                                    企业名称：{selectedFarm.enterprise_name} | 发电类型：{selectedFarm.power_type} | 装机容量：{selectedFarm.capacity || "无"}
                                </Typography>
                                <Typography color="text.secondary">
                                    省份：{selectedFarm.province || "无"} | 已关联识别点：{selectedFarm.associated_count}
                                </Typography>
                                <Stack spacing={1.5}>
                                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                                        范围内关联
                                    </Typography>
                                    <Grid container spacing={2}>
                                        {autoAssociated.filter((item) => item.image_url).length ? (
                                            autoAssociated
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
                                                <Typography color="text.secondary">当前范围内暂无可预览图片。</Typography>
                                            </Grid>
                                        )}
                                    </Grid>
                                </Stack>
                                <Stack spacing={1.5}>
                                    <Stack
                                        direction={{ xs: "column", md: "row" }}
                                        justifyContent="space-between"
                                        spacing={1.5}
                                        alignItems={{ xs: "flex-start", md: "center" }}
                                    >
                                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                                            附加关联
                                        </Typography>
                                        <Stack direction="row" spacing={1}>
                                            <Button
                                                variant="outlined"
                                                color="error"
                                                onClick={() => void removeAllManualAssociations()}
                                                disabled={!mergedManualAssociated.length || deletingManualAssociationId !== null}
                                            >
                                                删除全部附加关联
                                            </Button>
                                            <Button
                                                variant="contained"
                                                onClick={() => void saveManualAssociations()}
                                                disabled={!pendingManualOutliers.length || savingManualAssociations}
                                            >
                                                保存附加关联
                                            </Button>
                                        </Stack>
                                    </Stack>
                                    <Grid container spacing={2}>
                                        {mergedManualAssociated.filter((item) => item.image_url).length ? (
                                            mergedManualAssociated
                                                .filter((item) => item.image_url)
                                                .map((item) => (
                                                    <Grid key={item.id} size={{ xs: 6, sm: 4, md: 3, lg: 2 }}>
                                                        <Box sx={{ position: "relative" }}>
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
                                                            <Button
                                                                size="small"
                                                                onClick={() => void removeManualAssociation(item.id)}
                                                                disabled={deletingManualAssociationId === item.id}
                                                                sx={{
                                                                    position: "absolute",
                                                                    top: 8,
                                                                    right: 8,
                                                                    minWidth: 0,
                                                                    width: 30,
                                                                    height: 30,
                                                                    borderRadius: "50%",
                                                                    p: 0,
                                                                    backgroundColor: "rgba(255,255,255,0.92)",
                                                                    color: "#c62828",
                                                                    boxShadow: "0 4px 12px rgba(0,0,0,0.16)",
                                                                    "&:hover": {
                                                                        backgroundColor: "#fff5f5",
                                                                    },
                                                                }}
                                                            >
                                                                <DeleteOutlineIcon sx={{ fontSize: 18 }} />
                                                            </Button>
                                                        </Box>
                                                    </Grid>
                                                ))
                                        ) : (
                                            <Grid size={12}>
                                                <Typography color="text.secondary">当前没有附加关联图片。</Typography>
                                            </Grid>
                                        )}
                                    </Grid>
                                </Stack>
                            </Stack>
                        </CardContent>
                    </Card>
                ) : null}
            </Stack>
        </>
    );
}
