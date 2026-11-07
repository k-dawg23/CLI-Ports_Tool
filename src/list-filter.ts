import type { PortProcess } from "./types.js";

export interface ListFilters { port?: number; pid?: number; project?: string }

export function filterListRows(rows: readonly PortProcess[], filters: ListFilters): PortProcess[] {
  return rows.filter(row =>
    (filters.port === undefined || row.port === filters.port) &&
    (filters.pid === undefined || row.pid === filters.pid) &&
    (filters.project === undefined || row.projectName.toLowerCase().includes(filters.project.toLowerCase()))
  );
}
