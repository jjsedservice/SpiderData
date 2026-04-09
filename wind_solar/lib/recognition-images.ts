import fs from "node:fs/promises";
import path from "node:path";
import { readSettings } from "@/lib/settings";

const globalStore = globalThis as typeof globalThis & {
    __windSolarImageMaps?: Map<string, Map<string, string>>;
};

const imageMaps = globalStore.__windSolarImageMaps ?? new Map<string, Map<string, string>>();
globalStore.__windSolarImageMaps = imageMaps;

async function buildImageMap(root: string) {
    const map = new Map<string, string>();

    async function walk(current: string): Promise<void> {
        const entries = await fs.readdir(current, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.startsWith(".")) {
                continue;
            }
            const target = path.join(current, entry.name);
            if (entry.isDirectory()) {
                await walk(target);
            } else {
                map.set(entry.name, target);
            }
        }
    }

    await walk(root);
    return map;
}

export async function findRecognitionImage(
    type: "solar" | "wind",
    fileName: string,
): Promise<string | null> {
    const settings = await readSettings();
    const relativeDir = type === "solar" ? settings.solarImageDir : settings.windImageDir;
    const root = path.join(process.cwd(), "assets", relativeDir);

    let map = imageMaps.get(root);
    if (!map) {
        map = await buildImageMap(root);
        imageMaps.set(root, map);
    }

    return map.get(fileName) ?? null;
}
