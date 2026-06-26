export type ParsedEtlRecord = {
  id: string;
  date_published?: string | null;
  report_number?: string | null;
  source_domain?: string | null;
  description?: string | null;
  title: string;
  url: string;
  tags?: string[] | null;
  created_date?: string | null;
};

export type PythonEtlImportResult = {
  totalRows: number;
  records: ParsedEtlRecord[];
  skippedRows: number;
  failedRows: number;
  skippedDetails?: Array<{ row: number; reason: string }>;
  failedDetails?: Array<{ row: number; reason: string }>;
};

export type EtlImportSummary = {
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  failedRows: number;
};

export const ETL_ALLOWED_EXTENSIONS = [".csv", ".xlsx", ".xls"] as const;

export const ETL_MAX_FILE_BYTES = 50 * 1024 * 1024;

export const ETL_INSERT_BATCH_SIZE = 500;

export const ETL_REPORTS_UPLOAD_PATH = "/admin/etl/reports/upload";
