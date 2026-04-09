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
            image_exists INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
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
