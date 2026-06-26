import fs from "node:fs";
import path from "node:path";
import Transport from "winston-transport";
import {
  buildTableLogRow,
  formatTableHeader,
  formatTableRow,
  formatTableSeparator,
} from "./tableFormat.js";

function ensureTableHeader(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    const header = [
      formatTableHeader(),
      formatTableSeparator(),
    ].join("\n");
    fs.writeFileSync(filePath, `${header}\n`, "utf8");
    return;
  }

  const stats = fs.statSync(filePath);
  if (stats.size === 0) {
    const header = [
      formatTableHeader(),
      formatTableSeparator(),
    ].join("\n");
    fs.writeFileSync(filePath, `${header}\n`, "utf8");
  }
}

export class TableFileTransport extends Transport {
  private readonly filePath: string;

  constructor(filePath: string, opts?: Transport.TransportStreamOptions) {
    super(opts);
    this.filePath = path.resolve(filePath);
    ensureTableHeader(this.filePath);
  }

  log(info: Record<string, unknown>, callback: () => void): void {
    setImmediate(() => {
      this.emit("logged", info);
    });

    try {
      ensureTableHeader(this.filePath);
      const row = formatTableRow(buildTableLogRow(info));
      fs.appendFileSync(this.filePath, `${row}\n`, "utf8");
    } catch (err) {
      process.stderr.write(
        `[logger] failed to write table log file: ${
          err instanceof Error ? err.message : String(err)
        }\n`,
      );
    }

    callback();
  }
}
