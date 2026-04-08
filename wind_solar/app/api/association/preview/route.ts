import { NextResponse } from "next/server";
import { execRows, getDatabase } from "@/lib/db";
import { findRecognitionImage } from "@/lib/recognition-images";

type EnergyType = "wind" | "solar";

type FarmRow = {
    id: number;
    enterprise_name: string;
    site_name: string;
    power_type: string;
    capacity: string;
    province: string;
    longitude: string;
    latitude: string;
};

type RecognitionRow = {
    id: number;
    original_image: string;
    province_name: string;
    city: string;
    longitude: string;
    latitude: string;
    image_exists: number;
};

type Point = {
    lng: number;
    lat: number;
};

function toRadians(value: number) {
    return (value * Math.PI) / 180;
}

function distanceKm(a: Point, b: Point) {
    const earthRadiusKm = 6371;
    const dLat = toRadians(b.lat - a.lat);
    const dLng = toRadians(b.lng - a.lng);
    const startLat = toRadians(a.lat);
    const endLat = toRadians(b.lat);

    const haversine =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(startLat) * Math.cos(endLat) * Math.sin(dLng / 2) ** 2;

    return 2 * earthRadiusKm * Math.asin(Math.sqrt(haversine));
}

function cross(o: Point, a: Point, b: Point) {
    return (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
}

function convexHull(points: Point[]) {
    if (points.length <= 2) {
        return points;
    }

    const sorted = [...points].sort((a, b) =>
        a.lng === b.lng ? a.lat - b.lat : a.lng - b.lng,
    );
    const lower: Point[] = [];
    for (const point of sorted) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
            lower.pop();
        }
        lower.push(point);
    }

    const upper: Point[] = [];
    for (const point of [...sorted].reverse()) {
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
            upper.pop();
        }
        upper.push(point);
    }

    lower.pop();
    upper.pop();
    return [...lower, ...upper];
}

const provinceAliases: Record<string, string[]> = {
    北京: ["北京", "北京市"],
    天津: ["天津", "天津市"],
    河北: ["河北", "河北省"],
    山西: ["山西", "山西省"],
    内蒙古: ["内蒙古", "内蒙古自治区"],
    辽宁: ["辽宁", "辽宁省"],
    吉林: ["吉林", "吉林省"],
    黑龙江: ["黑龙江", "黑龙江省"],
    上海: ["上海", "上海市"],
    江苏: ["江苏", "江苏省"],
    浙江: ["浙江", "浙江省"],
    安徽: ["安徽", "安徽省"],
    福建: ["福建", "福建省"],
    江西: ["江西", "江西省"],
    山东: ["山东", "山东省"],
    河南: ["河南", "河南省"],
    湖北: ["湖北", "湖北省"],
    湖南: ["湖南", "湖南省"],
    广东: ["广东", "广东省"],
    广西: ["广西", "广西壮族自治区"],
    海南: ["海南", "海南省"],
    重庆: ["重庆", "重庆市"],
    四川: ["四川", "四川省"],
    贵州: ["贵州", "贵州省"],
    云南: ["云南", "云南省"],
    西藏: ["西藏", "西藏自治区"],
    陕西: ["陕西", "陕西省"],
    甘肃: ["甘肃", "甘肃省"],
    青海: ["青海", "青海省"],
    宁夏: ["宁夏", "宁夏回族自治区"],
    新疆: ["新疆", "新疆维吾尔自治区"],
    台湾: ["台湾", "台湾省"],
    香港: ["香港", "香港特别行政区"],
    澳门: ["澳门", "澳门特别行政区"],
};

function provinceClause(column: string, province: string) {
    const aliases = provinceAliases[province] ?? [province];
    return `(${aliases
        .map((item) => `${column} LIKE '%${item.replaceAll("'", "''")}%'`)
        .join(" OR ")})`;
}

function parseCoordinate(value: string) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function energyMatchClause(type: EnergyType) {
    return type === "wind"
        ? "power_type = '风电'"
        : "(power_type = '太阳能发电' OR power_type = '分布式光伏')";
}

async function enrichRecognition(type: EnergyType, row: RecognitionRow) {
    const filePath = row.image_exists
        ? await findRecognitionImage(type, String(row.original_image))
        : null;

    return {
        ...row,
        image_url: filePath
            ? `/api/recognition/image?type=${type}&name=${encodeURIComponent(String(row.original_image))}`
            : null,
    };
}

export async function GET(request: Request) {
    try {
        const { db } = await getDatabase();
        const { searchParams } = new URL(request.url);
        const type = (searchParams.get("type") ?? "wind") as EnergyType;
        const radiusKm = Number(searchParams.get("radiusKm") ?? "10");
        const province = (searchParams.get("province") ?? "").trim();
        const farmClauses = [energyMatchClause(type)];
        if (province) {
            farmClauses.push(provinceClause("province", province));
        }

        const recognitionTable = type === "wind" ? "wind_recognition" : "solar_recognition";
        const recognitionClauses: string[] = [];
        if (province) {
            recognitionClauses.push(
                `(${provinceClause("province_name", province)} OR ${provinceClause("province_code", province)})`,
            );
        }

        const farms = execRows<FarmRow>(
            db,
            `SELECT id, enterprise_name, site_name, power_type, capacity, province, longitude, latitude
             FROM power_fields
             WHERE ${farmClauses.join(" AND ")}
             ORDER BY enterprise_name ASC`,
        ).filter((row) => parseCoordinate(String(row.longitude)) !== null && parseCoordinate(String(row.latitude)) !== null);

        const recognitionRows = execRows<RecognitionRow>(
            db,
            `SELECT id, original_image, province_name, city, longitude, latitude, image_exists
             FROM ${recognitionTable}
             ${recognitionClauses.length ? `WHERE ${recognitionClauses.join(" AND ")}` : ""}
             ORDER BY id DESC`,
        ).filter((row) => parseCoordinate(String(row.longitude)) !== null && parseCoordinate(String(row.latitude)) !== null);

        const enrichedRecognition = await Promise.all(
            recognitionRows.map((row) => enrichRecognition(type, row)),
        );

        const farmMap = new Map(
            farms.map((farm) => [
                farm.id,
                {
                    ...farm,
                    longitude: Number(farm.longitude),
                    latitude: Number(farm.latitude),
                    associated: [] as Array<
                        RecognitionRow & {
                            image_url: string | null;
                            distance_km: number;
                        }
                    >,
                },
            ]),
        );

        const outliers: Array<
            RecognitionRow & {
                image_url: string | null;
            }
        > = [];

        for (const recognition of enrichedRecognition) {
            const point = {
                lng: Number(recognition.longitude),
                lat: Number(recognition.latitude),
            };

            let matchedFarmId: number | null = null;
            let nearestDistance = Number.POSITIVE_INFINITY;

            for (const farm of farmMap.values()) {
                const distance = distanceKm(point, {
                    lng: farm.longitude,
                    lat: farm.latitude,
                });
                if (distance <= radiusKm && distance < nearestDistance) {
                    matchedFarmId = farm.id;
                    nearestDistance = distance;
                }
            }

            if (matchedFarmId === null) {
                outliers.push(recognition);
                continue;
            }

            farmMap.get(matchedFarmId)?.associated.push({
                ...recognition,
                distance_km: Number(nearestDistance.toFixed(3)),
            });
        }

        const farmsWithSummary = Array.from(farmMap.values()).map((farm) => {
            const hullSeed = [
                { lng: farm.longitude, lat: farm.latitude },
                ...farm.associated.map((item) => ({
                    lng: Number(item.longitude),
                    lat: Number(item.latitude),
                })),
            ];
            const hullPoints = convexHull(hullSeed);

            return {
                id: farm.id,
                enterprise_name: farm.enterprise_name,
                site_name: farm.site_name,
                power_type: farm.power_type,
                capacity: farm.capacity,
                province: farm.province,
                longitude: farm.longitude,
                latitude: farm.latitude,
                associated_count: farm.associated.length,
                boundary: hullPoints,
                preview_images: farm.associated
                    .filter((item) => item.image_url)
                    .slice(0, 8)
                    .map((item) => ({
                        id: item.id,
                        original_image: item.original_image,
                        image_url: item.image_url,
                    })),
                associated: farm.associated,
            };
        });

        return NextResponse.json({
            ok: true,
            summary: {
                farm_count: farmsWithSummary.length,
                linked_farm_count: farmsWithSummary.filter((farm) => farm.associated_count > 0).length,
                recognition_count: enrichedRecognition.length,
                linked_recognition_count: enrichedRecognition.length - outliers.length,
                outlier_count: outliers.length,
            },
            farms: farmsWithSummary,
            outliers,
        });
    } catch (error) {
        return NextResponse.json(
            { ok: false, message: error instanceof Error ? error.message : "预览失败" },
            { status: 400 },
        );
    }
}
