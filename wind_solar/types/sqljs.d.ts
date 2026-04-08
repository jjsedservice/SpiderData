declare module "sql.js" {
    export type QueryExecResult = {
        columns: string[];
        values: Array<Array<string | number | null>>;
    };

    export interface Database {
        run(sql: string): void;
        exec(sql: string): QueryExecResult[];
        export(): Uint8Array;
    }

    export interface SqlJsStatic {
        Database: new (data?: Uint8Array | Buffer) => Database;
    }

    export default function initSqlJs(options?: {
        locateFile?: (file: string) => string;
    }): Promise<SqlJsStatic>;
}
