type ImportJob = {
    id: string;
    type: "power-fields" | "solar-recognition" | "wind-recognition";
    total: number;
    processed: number;
    status: "pending" | "running" | "completed" | "failed";
    error: string | null;
    startedAt: number;
};

const globalStore = globalThis as typeof globalThis & {
    __windSolarImportJobs?: Map<string, ImportJob>;
};

const jobs = globalStore.__windSolarImportJobs ?? new Map<string, ImportJob>();
globalStore.__windSolarImportJobs = jobs;

export function createImportJob(type: ImportJob["type"], total: number) {
    const job: ImportJob = {
        id: crypto.randomUUID(),
        type,
        total,
        processed: 0,
        status: "pending",
        error: null,
        startedAt: Date.now(),
    };

    jobs.set(job.id, job);
    return job;
}

export function updateImportJob(id: string, patch: Partial<ImportJob>) {
    const current = jobs.get(id);
    if (!current) {
        return;
    }
    jobs.set(id, { ...current, ...patch });
}

export function getImportJob(id: string) {
    return jobs.get(id) ?? null;
}
