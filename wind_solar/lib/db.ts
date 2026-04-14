import fs from "node:fs/promises";
import path from "node:path";
import initSqlJs, { type Database as SqlDatabase, type SqlJsStatic } from "sql.js";
import { readSettings } from "@/lib/settings";

let cachedPath = "";
let cachedDb: SqlDatabase | null = null;
let sqlRuntimePromise: Promise<SqlJsStatic> | null = null;

async function ensureDatabaseDirectory(filePath: string) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function getRuntime() {
    if (!sqlRuntimePromise) {
        sqlRuntimePromise = initSqlJs({
            locateFile: (file) => path.join(process.cwd(), "node_modules/sql.js/dist", file),
        });
    }

    return sqlRuntimePromise;
}

function initializeSchema(db: SqlDatabase) {
    db.run(`
        CREATE TABLE IF NOT EXISTS power_fields (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            enterprise_name TEXT NOT NULL UNIQUE,
            subject_name TEXT,
            site_name TEXT,
            power_type TEXT,
            capacity TEXT,
            longitude TEXT,
            latitude TEXT,
            supplement TEXT,
            raw_address TEXT,
            standardized_address TEXT,
            province TEXT,
            city TEXT,
            district TEXT,
            town TEXT,
            village TEXT,
            group_name TEXT,
            confidence REAL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS solar_recognition (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            original_image TEXT NOT NULL UNIQUE,
            province_code TEXT,
            province_name TEXT,
            city TEXT,
            longitude TEXT,
            latitude TEXT,
            poi TEXT,
            image_exists INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS wind_recognition (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            original_image TEXT NOT NULL UNIQUE,
            province_code TEXT,
            province_name TEXT,
            city TEXT,
            longitude TEXT,
            latitude TEXT,
            poi TEXT,
            image_exists INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS manual_associations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            energy_type TEXT NOT NULL,
            farm_id INTEGER NOT NULL,
            recognition_id INTEGER NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(energy_type, farm_id, recognition_id)
        );
    `);

    const columns = db.exec("PRAGMA table_info(power_fields)");
    const hasPowerTypeColumn = columns[0]?.values.some((valueRow) => valueRow[1] === "power_type");
    const hasCapacityColumn = columns[0]?.values.some((valueRow) => valueRow[1] === "capacity");
    if (!hasPowerTypeColumn) {
        db.run("ALTER TABLE power_fields ADD COLUMN power_type TEXT");
    }
    if (!hasCapacityColumn) {
        db.run("ALTER TABLE power_fields ADD COLUMN capacity TEXT");
    }
    const solarColumns = db.exec("PRAGMA table_info(solar_recognition)");
    const hasSolarPoiColumn = solarColumns[0]?.values.some((valueRow) => valueRow[1] === "poi");
    if (!hasSolarPoiColumn) {
        db.run("ALTER TABLE solar_recognition ADD COLUMN poi TEXT");
    }
    const windColumns = db.exec("PRAGMA table_info(wind_recognition)");
    const hasWindPoiColumn = windColumns[0]?.values.some((valueRow) => valueRow[1] === "poi");
    if (!hasWindPoiColumn) {
        db.run("ALTER TABLE wind_recognition ADD COLUMN poi TEXT");
    }
}

async function persistDatabase(db: SqlDatabase, filePath: string) {
    await fs.writeFile(filePath, Buffer.from(db.export()));
}

export async function getDatabase() {
    const settings = await readSettings();
    const filePath = path.join(process.cwd(), "assets", settings.dataFile);

    if (!cachedDb || cachedPath !== filePath) {
        await ensureDatabaseDirectory(filePath);
        const SQL = await getRuntime();
        const exists = await fs
            .access(filePath)
            .then(() => true)
            .catch(() => false);
        const buffer = exists ? await fs.readFile(filePath) : null;
        cachedDb = buffer ? new SQL.Database(buffer) : new SQL.Database();
        cachedPath = filePath;
        initializeSchema(cachedDb);
        await persistDatabase(cachedDb, filePath);
    }

    return {
        db: cachedDb,
        filePath,
        persist: async () => persistDatabase(cachedDb!, filePath),
    };
}

export async function getDatabasePath() {
    const settings = await readSettings();
    return path.join(process.cwd(), "assets", settings.dataFile);
}

export function execRows<T extends Record<string, unknown>>(db: SqlDatabase, sql: string) {
    const results = db.exec(sql);
    if (!results.length) {
        return [] as T[];
    }
    const [first] = results;
    return first.values.map((valueRow) => {
        const row: Record<string, unknown> = {};
        first.columns.forEach((column, index) => {
            row[column] = valueRow[index];
        });
        return row as T;
    });
}

export function escapeSql(value: string) {
    return value.replaceAll("'", "''");
}
