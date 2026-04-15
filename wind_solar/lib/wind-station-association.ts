import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { execRows, getDatabase } from "@/lib/db";

export type SessionFileType = "merge" | "station";

export type SessionScanPoint = {
    distanceKm: number;
    count: number;
};

export type StableSegment = {
    startKm: number;
    endKm: number;
    count: number;
    length: number;
    targetDistances: string[];
    suggestedTargetDist: string;
};

export type WindStationSession = {
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

type WindRecognitionRow = {
    id: number;
    original_image: string;
    province_code: string;
    province_name: string;
    city: string;
    longitude: string;
    latitude: string;
    area?: string | null;
    capacity?: string | null;
    image_exists: number;
};

type PowerFieldRow = {
    enterprise_name: string;
    subject_name: string;
    site_name: string;
    power_type: string;
    capacity: string;
    province: string;
    longitude: string;
    latitude: string;
};

type CoordinatePoint = {
    lon: number;
    lat: number;
};

type ClusterEdge = {
    i: number;
    j: number;
    distanceKm: number;
};

const tokensRoot = path.join(process.cwd(), "assets", "tokens");

const provinceDefinitions = [
    { name: "北京", aliases: ["北京", "北京市"], codes: ["beijing"] },
    { name: "天津", aliases: ["天津", "天津市"], codes: ["tianjin"] },
    { name: "河北", aliases: ["河北", "河北省"], codes: ["hebei"] },
    { name: "山西", aliases: ["山西", "山西省"], codes: ["shanxi"] },
    { name: "内蒙古", aliases: ["内蒙古", "内蒙古自治区"], codes: ["neimenggu", "innermongolia"] },
    { name: "辽宁", aliases: ["辽宁", "辽宁省"], codes: ["liaoning"] },
    { name: "吉林", aliases: ["吉林", "吉林省"], codes: ["jilin"] },
    { name: "黑龙江", aliases: ["黑龙江", "黑龙江省"], codes: ["heilongjiang"] },
    { name: "上海", aliases: ["上海", "上海市"], codes: ["shanghai"] },
    { name: "江苏", aliases: ["江苏", "江苏省"], codes: ["jiangsu"] },
    { name: "浙江", aliases: ["浙江", "浙江省"], codes: ["zhejiang"] },
    { name: "安徽", aliases: ["安徽", "安徽省"], codes: ["anhui"] },
    { name: "福建", aliases: ["福建", "福建省"], codes: ["fujian"] },
    { name: "江西", aliases: ["江西", "江西省"], codes: ["jiangxi"] },
    { name: "山东", aliases: ["山东", "山东省"], codes: ["shandong"] },
    { name: "河南", aliases: ["河南", "河南省"], codes: ["henan"] },
    { name: "湖北", aliases: ["湖北", "湖北省"], codes: ["hubei"] },
    { name: "湖南", aliases: ["湖南", "湖南省"], codes: ["hunan"] },
    { name: "广东", aliases: ["广东", "广东省"], codes: ["guangdong"] },
    { name: "广西", aliases: ["广西", "广西壮族自治区"], codes: ["guangxi"] },
    { name: "海南", aliases: ["海南", "海南省"], codes: ["hainan"] },
    { name: "重庆", aliases: ["重庆", "重庆市"], codes: ["chongqing"] },
    { name: "四川", aliases: ["四川", "四川省"], codes: ["sichuan"] },
    { name: "贵州", aliases: ["贵州", "贵州省"], codes: ["guizhou"] },
    { name: "云南", aliases: ["云南", "云南省"], codes: ["yunnan"] },
    { name: "西藏", aliases: ["西藏", "西藏自治区"], codes: ["xizang", "tibet"] },
    { name: "陕西", aliases: ["陕西", "陕西省"], codes: ["shanxi1", "shaanxi"] },
    { name: "甘肃", aliases: ["甘肃", "甘肃省"], codes: ["gansu"] },
    { name: "青海", aliases: ["青海", "青海省"], codes: ["qinghai"] },
    { name: "宁夏", aliases: ["宁夏", "宁夏回族自治区"], codes: ["ningxia"] },
    { name: "新疆", aliases: ["新疆", "新疆维吾尔自治区"], codes: ["xinjiang"] },
    { name: "台湾", aliases: ["台湾", "台湾省"], codes: ["taiwan"] },
    { name: "香港", aliases: ["香港", "香港特别行政区"], codes: ["hongkong", "hong_kong"] },
    { name: "澳门", aliases: ["澳门", "澳门特别行政区"], codes: ["macao", "macau"] },
] as const;

function normalizeText(value: string | null | undefined) {
    return String(value ?? "").trim().toLowerCase();
}

function provinceMatches(value: string | null | undefined, province: string) {
    const normalized = normalizeText(value);
    if (!normalized) {
        return false;
    }

    const definition =
        provinceDefinitions.find((item) => item.name === province) ??
        null;
    if (!definition) {
        return normalized.includes(normalizeText(province));
    }

    return [...definition.aliases, ...definition.codes].some((item) =>
        normalized.includes(normalizeText(item)),
    );
}

function parseCoordinate(value: string) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function toRadians(value: number) {
    return (value * Math.PI) / 180;
}

function haversineDistanceKm(a: CoordinatePoint, b: CoordinatePoint) {
    const earthRadiusKm = 6371.0088;
    const dLat = toRadians(b.lat - a.lat);
    const dLon = toRadians(b.lon - a.lon);
    const startLat = toRadians(a.lat);
    const endLat = toRadians(b.lat);
    const x =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(startLat) * Math.cos(endLat) * Math.sin(dLon / 2) ** 2;
    return 2 * earthRadiusKm * Math.asin(Math.sqrt(x));
}

function formatDistanceLabel(distanceKm: number) {
    return `${distanceKm.toFixed(1)}km`;
}

function createScanRange(maxDistanceKm: number, stepKm: number) {
    const values: number[] = [];
    for (let current = 1; current <= maxDistanceKm + Number.EPSILON; current += stepKm) {
        values.push(Number(current.toFixed(1)));
    }
    return values;
}

function createMatchRange() {
    const values: number[] = [];
    for (let current = 10; current < 200; current += 5) {
        values.push(current);
    }
    return values;
}

class UnionFind {
    parent: number[];
    rank: number[];

    constructor(size: number) {
        this.parent = Array.from({ length: size }, (_, index) => index);
        this.rank = Array.from({ length: size }, () => 0);
    }

    find(value: number): number {
        if (this.parent[value] !== value) {
            this.parent[value] = this.find(this.parent[value]);
        }
        return this.parent[value];
    }

    union(a: number, b: number) {
        const rootA = this.find(a);
        const rootB = this.find(b);
        if (rootA === rootB) {
            return;
        }

        if (this.rank[rootA] < this.rank[rootB]) {
            this.parent[rootA] = rootB;
            return;
        }
        if (this.rank[rootA] > this.rank[rootB]) {
            this.parent[rootB] = rootA;
            return;
        }

        this.parent[rootB] = rootA;
        this.rank[rootA] += 1;
    }
}

function toCsvValue(value: unknown) {
    const text = String(value ?? "");
    if (/[",\n]/.test(text)) {
        return `"${text.replaceAll('"', '""')}"`;
    }
    return text;
}

function encodeCsv(rows: Array<Record<string, unknown>>, headers: string[]) {
    const lines = [
        headers.map(toCsvValue).join(","),
        ...rows.map((row) => headers.map((header) => toCsvValue(row[header])).join(",")),
    ];
    return `\uFEFF${lines.join("\n")}`;
}

async function writeCsv(filePath: string, rows: Array<Record<string, unknown>>, headers: string[]) {
    await fs.writeFile(filePath, encodeCsv(rows, headers), "utf-8");
}

async function readCsv(filePath: string) {
    const content = await fs.readFile(filePath, "utf-8");
    return parse(content.replace(/^\uFEFF/, ""), {
        columns: true,
        skip_empty_lines: true,
        trim: true,
    }) as Array<Record<string, string>>;
}

async function ensureSessionRoot() {
    await fs.mkdir(tokensRoot, { recursive: true });
}

function getSessionDir(sessionId: string) {
    return path.join(tokensRoot, sessionId);
}

function getSessionFilePath(sessionId: string, type: SessionFileType) {
    return path.join(getSessionDir(sessionId), `${type}.csv`);
}

function getSessionJsonPath(sessionId: string) {
    return path.join(getSessionDir(sessionId), "session.json");
}

async function readSession(sessionId: string): Promise<WindStationSession | null> {
    try {
        const content = await fs.readFile(getSessionJsonPath(sessionId), "utf-8");
        return JSON.parse(content) as WindStationSession;
    } catch {
        return null;
    }
}

async function writeSession(session: WindStationSession) {
    await fs.mkdir(getSessionDir(session.id), { recursive: true });
    session.updatedAt = new Date().toISOString();
    await fs.writeFile(getSessionJsonPath(session.id), `${JSON.stringify(session, null, 2)}\n`, "utf-8");
}

async function loadWindRecognitionByProvince(province: string) {
    const { db } = await getDatabase();
    const rows = execRows<WindRecognitionRow>(
        db,
        "SELECT * FROM wind_recognition ORDER BY id ASC",
    );
    return rows.filter((row) =>
        provinceMatches(row.province_name, province) || provinceMatches(row.province_code, province),
    );
}

async function loadWindPowerFieldsByProvince(province: string) {
    const { db } = await getDatabase();
    const rows = execRows<PowerFieldRow>(
        db,
        "SELECT enterprise_name, subject_name, site_name, power_type, capacity, province, longitude, latitude FROM power_fields ORDER BY enterprise_name ASC",
    );
    return rows.filter((row) => {
        const isWind = String(row.power_type ?? "").includes("风电");
        return isWind && provinceMatches(row.province, province);
    });
}

function detectStableSegments(points: SessionScanPoint[]) {
    const segments: StableSegment[] = [];
    let startIndex = 0;

    while (startIndex < points.length - 1) {
        let endIndex = startIndex;
        while (
            endIndex + 1 < points.length &&
            points[endIndex + 1].count === points[startIndex].count
        ) {
            endIndex += 1;
        }

        if (endIndex > startIndex) {
            const targetDistances = points
                .slice(startIndex, endIndex + 1)
                .map((point) => formatDistanceLabel(point.distanceKm));
            const midpoint = targetDistances[Math.floor(targetDistances.length / 2)] ?? targetDistances[0];
            segments.push({
                startKm: points[startIndex].distanceKm,
                endKm: points[endIndex].distanceKm,
                count: points[startIndex].count,
                length: endIndex - startIndex + 1,
                targetDistances,
                suggestedTargetDist: midpoint,
            });
        }

        startIndex = endIndex + 1;
    }

    return segments;
}

function chooseSuggestedTargetDist(
    segments: StableSegment[],
    scanPoints: SessionScanPoint[],
    stationReferenceCount: number,
) {
    void segments;
    void stationReferenceCount;

    for (let index = 0; index < scanPoints.length - 1; index += 1) {
        const current = scanPoints[index];
        const next = scanPoints[index + 1];
        if (current.count !== next.count) {
            continue;
        }
        return formatDistanceLabel(next.distanceKm);
    }

    return scanPoints[0] ? formatDistanceLabel(scanPoints[0].distanceKm) : null;
}

function buildEdges(points: CoordinatePoint[], maxDistanceKm: number) {
    const edges: ClusterEdge[] = [];
    for (let i = 0; i < points.length; i += 1) {
        for (let j = i + 1; j < points.length; j += 1) {
            const distanceKm = haversineDistanceKm(points[i], points[j]);
            if (distanceKm <= maxDistanceKm) {
                edges.push({ i, j, distanceKm });
            }
        }
    }
    edges.sort((a, b) => a.distanceKm - b.distanceKm);
    return edges;
}

export async function runClusterScan(input: {
    province: string;
    maxDistanceKm: number;
    stepKm: number;
}) {
    await ensureSessionRoot();
    const sourceRows = await loadWindRecognitionByProvince(input.province);
    const validRows = sourceRows.filter((row) => {
        const longitude = parseCoordinate(String(row.longitude));
        const latitude = parseCoordinate(String(row.latitude));
        return longitude !== null && latitude !== null;
    });

    if (!validRows.length) {
        throw new Error("当前省份没有可用于聚类的风电识别坐标");
    }

    const stationReferenceCount = (await loadWindPowerFieldsByProvince(input.province)).length;
    const distances = createScanRange(input.maxDistanceKm, input.stepKm);
    const points = validRows.map((row) => ({
        lon: Number(row.longitude),
        lat: Number(row.latitude),
    }));
    const edges = buildEdges(points, input.maxDistanceKm);
    const unionFind = new UnionFind(points.length);
    const mergeRows = validRows.map((row) => ({
        原始图片: row.original_image,
        省: row.province_name ?? "",
        市: row.city ?? "",
        经度: row.longitude,
        纬度: row.latitude,
    })) as Array<Record<string, unknown>>;
    const baseHeaders = Object.keys(mergeRows[0] ?? {});
    const csvHeaders = [...baseHeaders];
    const scanPoints: SessionScanPoint[] = [];
    let edgeIndex = 0;

    for (const distanceKm of distances) {
        while (edgeIndex < edges.length && edges[edgeIndex].distanceKm <= distanceKm + Number.EPSILON) {
            unionFind.union(edges[edgeIndex].i, edges[edgeIndex].j);
            edgeIndex += 1;
        }

        const rootToClusterId = new Map<number, number>();
        const clusterMembers = new Map<number, number[]>();
        validRows.forEach((_, rowIndex) => {
            const root = unionFind.find(rowIndex);
            if (!rootToClusterId.has(root)) {
                rootToClusterId.set(root, rootToClusterId.size);
            }
            const clusterId = rootToClusterId.get(root)!;
            const memberIndices = clusterMembers.get(clusterId) ?? [];
            memberIndices.push(rowIndex);
            clusterMembers.set(clusterId, memberIndices);
        });

        const label = formatDistanceLabel(distanceKm);
        const clusterIdColumn = `${label}_聚类序号`;
        const centerColumn = `${label}_聚类中心`;
        csvHeaders.push(clusterIdColumn, centerColumn);
        const centers = new Map<number, string>();

        clusterMembers.forEach((memberIndices, clusterId) => {
            const summary = memberIndices.reduce(
                (accumulator, memberIndex) => ({
                    lon: accumulator.lon + points[memberIndex].lon,
                    lat: accumulator.lat + points[memberIndex].lat,
                }),
                { lon: 0, lat: 0 },
            );
            centers.set(
                clusterId,
                `${summary.lon / memberIndices.length},${summary.lat / memberIndices.length}`,
            );
        });

        validRows.forEach((_, rowIndex) => {
            const root = unionFind.find(rowIndex);
            const clusterId = rootToClusterId.get(root)!;
            mergeRows[rowIndex][clusterIdColumn] = clusterId;
            mergeRows[rowIndex][centerColumn] = centers.get(clusterId) ?? "";
        });

        scanPoints.push({
            distanceKm,
            count: clusterMembers.size,
        });
    }

    const stableSegments = detectStableSegments(scanPoints);
    const suggestedTargetDist = chooseSuggestedTargetDist(
        stableSegments,
        scanPoints,
        stationReferenceCount,
    );
    const sessionId = crypto.randomUUID();
    const session: WindStationSession = {
        id: sessionId,
        province: input.province,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        files: {
            merge: "merge.csv",
            station: null,
        },
        scan: {
            maxDistanceKm: input.maxDistanceKm,
            stepKm: input.stepKm,
            rowCount: mergeRows.length,
            stationReferenceCount,
            scanPoints,
            stableSegments,
            suggestedTargetDist,
            selectedTargetDist: suggestedTargetDist,
        },
        match: null,
    };

    await fs.mkdir(getSessionDir(sessionId), { recursive: true });
    await writeCsv(getSessionFilePath(sessionId, "merge"), mergeRows, csvHeaders);
    await writeSession(session);

    return {
        session,
        mergeHeaders: csvHeaders,
        mergeRows,
    };
}

export async function runStationMatch(input: {
    sessionId: string;
    targetDist: string;
    bestMaxDist?: number;
}) {
    const session = await readSession(input.sessionId);
    if (!session?.scan) {
        throw new Error("会话不存在，或尚未完成聚类扫描");
    }

    const bestMaxDist = input.bestMaxDist ?? 20;
    const mergeRows = await readCsv(getSessionFilePath(input.sessionId, "merge"));
    const idColumn = `${input.targetDist}_聚类序号`;
    const centerColumn = `${input.targetDist}_聚类中心`;
    if (!mergeRows.length || !(idColumn in mergeRows[0])) {
        throw new Error("未找到所选聚类方案，请先完成聚类扫描");
    }

    const grouped = new Map<string, {
        longitude: number;
        latitude: number;
        count: number;
        center: string;
    }>();
    for (const row of mergeRows) {
        const clusterId = String(row[idColumn] ?? "");
        const longitude = parseCoordinate(String(row["经度"] ?? ""));
        const latitude = parseCoordinate(String(row["纬度"] ?? ""));
        if (!clusterId || longitude === null || latitude === null) {
            continue;
        }
        const current = grouped.get(clusterId) ?? {
            longitude: 0,
            latitude: 0,
            count: 0,
            center: String(row[centerColumn] ?? ""),
        };
        current.longitude += longitude;
        current.latitude += latitude;
        current.count += 1;
        current.center = current.center || String(row[centerColumn] ?? "");
        grouped.set(clusterId, current);
    }

    const clusterRows = Array.from(grouped.entries()).map(([clusterId, summary]) => ({
        clusterId,
        longitude: summary.longitude / summary.count,
        latitude: summary.latitude / summary.count,
        turbineCount: summary.count,
        center: summary.center,
    }));

    const companyRows = (await loadWindPowerFieldsByProvince(session.province))
        .map((row) => ({
            ...row,
            longitude: parseCoordinate(String(row.longitude)),
            latitude: parseCoordinate(String(row.latitude)),
            capacityNumber: Number(row.capacity),
        }))
        .filter((row) => row.longitude !== null && row.latitude !== null);

    if (!companyRows.length) {
        throw new Error("当前省份没有可匹配的风电场站台账数据");
    }

    const matchScanPoints: SessionScanPoint[] = [];
    let finalMatches: Array<Record<string, unknown>> = [];

    for (const distanceKm of createMatchRange()) {
        const candidates: Array<{
            pId: string;
            cId: string;
            score: number;
            data: Record<string, unknown>;
        }> = [];

        for (const clusterRow of clusterRows) {
            for (const companyRow of companyRows) {
                const distance = haversineDistanceKm(
                    { lon: clusterRow.longitude, lat: clusterRow.latitude },
                    { lon: companyRow.longitude!, lat: companyRow.latitude! },
                );
                if (distance > distanceKm) {
                    continue;
                }

                const estimatedCapacity = clusterRow.turbineCount * 3.0;
                const actualCapacity = Number.isFinite(companyRow.capacityNumber)
                    ? companyRow.capacityNumber
                    : 0;
                const denominator = Math.max(estimatedCapacity, actualCapacity);
                const capacityScore =
                    denominator > 0
                        ? Math.max(0, 1 - Math.abs(estimatedCapacity - actualCapacity) / denominator)
                        : 0;
                const distanceScore = 1 - distance / distanceKm;
                const totalScore = distanceScore * 0.7 + capacityScore * 0.3;

                candidates.push({
                    pId: clusterRow.clusterId,
                    cId: `${companyRow.enterprise_name}_${companyRow.site_name}`,
                    score: totalScore,
                    data: {
                        聚类序号: clusterRow.clusterId,
                        风机数量: clusterRow.turbineCount,
                        物理中心: clusterRow.center,
                        企业名称: companyRow.enterprise_name,
                        主体名称: companyRow.subject_name,
                        站点名称: companyRow.site_name,
                        台账容量: actualCapacity,
                        预估容量: Number(estimatedCapacity.toFixed(2)),
                        距离_km: Number(distance.toFixed(2)),
                        综合得分: Number(totalScore.toFixed(4)),
                    },
                });
            }
        }

        const sortedCandidates = [...candidates].sort((a, b) => b.score - a.score);
        const usedClusterIds = new Set<string>();
        const usedCompanyIds = new Set<string>();
        const currentMatches: Array<Record<string, unknown>> = [];

        for (const candidate of sortedCandidates) {
            if (usedClusterIds.has(candidate.pId) || usedCompanyIds.has(candidate.cId)) {
                continue;
            }
            usedClusterIds.add(candidate.pId);
            usedCompanyIds.add(candidate.cId);
            currentMatches.push(candidate.data);
        }

        if (distanceKm === bestMaxDist) {
            finalMatches = currentMatches;
        }

        matchScanPoints.push({
            distanceKm,
            count: currentMatches.length,
        });
    }

    const stationHeaders = [
        "聚类序号",
        "风机数量",
        "物理中心",
        "企业名称",
        "主体名称",
        "站点名称",
        "台账容量",
        "预估容量",
        "距离_km",
        "综合得分",
    ];
    await writeCsv(getSessionFilePath(input.sessionId, "station"), finalMatches, stationHeaders);

    session.files.station = "station.csv";
    session.scan.selectedTargetDist = input.targetDist;
    session.match = {
        targetDist: input.targetDist,
        bestMaxDist,
        stationCount: finalMatches.length,
        scanPoints: matchScanPoints,
    };
    await writeSession(session);

    return {
        session,
        stationHeaders,
        stationRows: finalMatches,
    };
}

export async function getSessionMeta(sessionId: string) {
    const session = await readSession(sessionId);
    if (!session) {
        throw new Error("会话不存在");
    }
    return session;
}

export async function getSessionCsvPage(input: {
    sessionId: string;
    file: SessionFileType;
    page: number;
    pageSize: number;
}) {
    const session = await readSession(input.sessionId);
    if (!session) {
        throw new Error("会话不存在");
    }
    const exists = input.file === "merge" ? session.files.merge : session.files.station;
    if (!exists) {
        throw new Error("当前会话还没有该步骤的结果文件");
    }

    const filePath = getSessionFilePath(input.sessionId, input.file);
    const rows = await readCsv(filePath);
    const headers = rows.length ? Object.keys(rows[0]) : [];
    const page = Math.max(1, input.page);
    const pageSize = Math.max(1, input.pageSize);
    return {
        headers,
        rows: rows.slice((page - 1) * pageSize, page * pageSize),
        total: rows.length,
    };
}
