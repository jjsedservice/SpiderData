import fs from "node:fs/promises";
import path from "node:path";

export type AppSettings = {
    windImageDir: string;
    solarImageDir: string;
    dataFile: string;
};

export type SettingsFormValues = {
    windImageDir: string;
    solarImageDir: string;
    dataFileName: string;
};

export type SettingsStatus = {
    configExists: boolean;
    isValid: boolean;
    issues: string[];
    settings: AppSettings;
    formValues: SettingsFormValues;
};

const projectRoot = process.cwd();
const assetsRoot = path.join(projectRoot, "assets");
const configPath = path.join(projectRoot, "config.yaml");

const defaultSettings: AppSettings = {
    windImageDir: "wind_result/map",
    solarImageDir: "solar_result/map",
    dataFile: "data/default.sqlite",
};

function parseYamlValue(value: string): string {
    const trimmed = value.trim();

    if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
        return trimmed.slice(1, -1);
    }

    return trimmed;
}

function serializeYaml(settings: AppSettings): string {
    return [
        `windImageDir: ${JSON.stringify(settings.windImageDir)}`,
        `solarImageDir: ${JSON.stringify(settings.solarImageDir)}`,
        `dataFile: ${JSON.stringify(settings.dataFile)}`,
        "",
    ].join("\n");
}

function settingsToFormValues(settings: AppSettings): SettingsFormValues {
    return {
        windImageDir: settings.windImageDir,
        solarImageDir: settings.solarImageDir,
        dataFileName: extractDataFileName(settings.dataFile),
    };
}

function normalizeRelativePath(input: string): string {
    const trimmed = input.trim().replace(/\\/g, "/");
    if (!trimmed) {
        throw new Error("路径不能为空");
    }
    if (path.isAbsolute(trimmed)) {
        throw new Error("路径必须是相对 assets 的相对路径");
    }

    const normalized = path.posix.normalize(trimmed);
    if (
        normalized === "." ||
        normalized.startsWith("../") ||
        normalized.includes("/../")
    ) {
        throw new Error("路径不能超出 assets 目录");
    }

    return normalized;
}

function resolveAssetPath(relativePath: string): string {
    const normalized = normalizeRelativePath(relativePath);
    const resolved = path.resolve(assetsRoot, normalized);
    const relative = path.relative(assetsRoot, resolved);

    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("路径不能超出 assets 目录");
    }

    return resolved;
}

function extractDataFileName(dataFile: string): string {
    const normalized = dataFile.replace(/\\/g, "/").trim();
    const baseName = normalized.startsWith("data/") ? normalized.slice(5) : normalized;
    return baseName.endsWith(".sqlite") ? baseName.slice(0, -7) : baseName;
}

function normalizeDataFileName(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) {
        throw new Error("数据文件名称不能为空");
    }
    if (trimmed.includes("/") || trimmed.includes("\\")) {
        throw new Error("数据文件名称不能包含路径");
    }

    const withoutExtension = trimmed.endsWith(".sqlite")
        ? trimmed.slice(0, -7)
        : trimmed;

    if (!withoutExtension) {
        throw new Error("数据文件名称不能为空");
    }

    return withoutExtension;
}

function buildDataFilePath(dataFileName: string): string {
    return `data/${normalizeDataFileName(dataFileName)}.sqlite`;
}

async function ensureDirectoryExists(relativePath: string, label: string): Promise<string> {
    const resolved = resolveAssetPath(relativePath);
    let stat;

    try {
        stat = await fs.stat(resolved);
    } catch {
        throw new Error(`${label}不存在: ${relativePath}`);
    }

    if (!stat.isDirectory()) {
        throw new Error(`${label}不是目录: ${relativePath}`);
    }

    return normalizeRelativePath(relativePath);
}

async function ensureDataFile(relativePath: string): Promise<string> {
    const normalized = normalizeRelativePath(relativePath);
    const resolved = resolveAssetPath(relativePath);
    const directory = path.dirname(resolved);

    await fs.mkdir(directory, { recursive: true });

    try {
        const stat = await fs.stat(resolved);
        if (!stat.isFile()) {
            throw new Error(`数据存放文件不是文件: ${relativePath}`);
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message.startsWith("数据存放文件不是文件")) {
            throw error;
        }
        await fs.writeFile(resolved, "", "utf-8");
    }

    return normalized;
}

async function validateDirectory(relativePath: string, label: string): Promise<void> {
    await ensureDirectoryExists(relativePath, label);
}

async function validateDataFile(relativePath: string): Promise<void> {
    const normalized = normalizeRelativePath(relativePath);
    if (!normalized.startsWith("data/") || !normalized.endsWith(".sqlite")) {
        throw new Error("数据存放文件必须位于 assets/data 目录下，且扩展名为 .sqlite");
    }

    const resolved = resolveAssetPath(normalized);

    try {
        const stat = await fs.stat(resolved);
        if (!stat.isFile()) {
            throw new Error(`数据存放文件不是文件: ${relativePath}`);
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message.startsWith("数据存放文件不是文件")) {
            throw error;
        }
        throw new Error(`数据存放文件不存在: ${relativePath}`);
    }
}

async function configExists(): Promise<boolean> {
    try {
        await fs.access(configPath);
        return true;
    } catch {
        return false;
    }
}

export async function readSettings(): Promise<AppSettings> {
    try {
        const content = await fs.readFile(configPath, "utf-8");
        const record: Record<string, string> = {};

        for (const line of content.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) {
                continue;
            }

            const separatorIndex = trimmed.indexOf(":");
            if (separatorIndex === -1) {
                continue;
            }

            const key = trimmed.slice(0, separatorIndex).trim();
            const value = trimmed.slice(separatorIndex + 1);
            record[key] = parseYamlValue(value);
        }

        return {
            windImageDir: record.windImageDir || defaultSettings.windImageDir,
            solarImageDir: record.solarImageDir || defaultSettings.solarImageDir,
            dataFile: record.dataFile || defaultSettings.dataFile,
        };
    } catch {
        return defaultSettings;
    }
}

export async function getSettingsStatus(): Promise<SettingsStatus> {
    const exists = await configExists();
    const settings = await readSettings();
    const issues: string[] = [];

    if (!exists) {
        issues.push("未找到配置文件");
    } else {
        try {
            await validateDirectory(settings.windImageDir, "风机图片目录");
        } catch (error) {
            issues.push(error instanceof Error ? error.message : "风机图片目录无效");
        }

        try {
            await validateDirectory(settings.solarImageDir, "光伏图片目录");
        } catch (error) {
            issues.push(error instanceof Error ? error.message : "光伏图片目录无效");
        }

        try {
            await validateDataFile(settings.dataFile);
        } catch (error) {
            issues.push(error instanceof Error ? error.message : "数据存放文件无效");
        }
    }

    return {
        configExists: exists,
        isValid: issues.length === 0,
        issues,
        settings,
        formValues: settingsToFormValues(settings),
    };
}

export async function saveSettings(input: SettingsFormValues): Promise<AppSettings> {
    const dataFile = buildDataFilePath(input.dataFileName);
    const settings: AppSettings = {
        windImageDir: await ensureDirectoryExists(input.windImageDir, "风机图片目录"),
        solarImageDir: await ensureDirectoryExists(input.solarImageDir, "光伏图片目录"),
        dataFile: await ensureDataFile(dataFile),
    };

    await fs.writeFile(configPath, serializeYaml(settings), "utf-8");

    return settings;
}
