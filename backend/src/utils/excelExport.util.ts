import * as XLSX from "xlsx";

export function formatExportDateTime(
  value: Date | string | null | undefined,
): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function exportDateStamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const monthName = now.toLocaleString("en-US", { month: "short" });
  return `${now.getFullYear()}-${monthName}-${pad(now.getDate())}`;
}

export function writeWorkbookToBuffer(workbook: XLSX.WorkBook): Buffer {
  return XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  }) as Buffer;
}
