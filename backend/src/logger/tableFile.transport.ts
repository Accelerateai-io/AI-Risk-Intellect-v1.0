import fs from "node:fs";
import Transport from "winston-transport";
import {
  APPLICATION_LOG_TABLE_HEADER,
  formatTableDataRow,
  normalizeWinstonInfo,
} from "./logRecord.js";

type TableFileTransportOptions = Transport.TransportStreamOptions & {
  filename: string;
};

export class TableFileTransport extends Transport {
  private readonly filename: string;
  private headerWritten = false;

  constructor(options: TableFileTransportOptions) {
    super(options);
    this.filename = options.filename;
    this.ensureHeader();
  }

  private ensureHeader(): void {
    if (!fs.existsSync(this.filename)) {
      fs.writeFileSync(this.filename, `${APPLICATION_LOG_TABLE_HEADER}\n`, "utf8");
      this.headerWritten = true;
      return;
    }

    const content = fs.readFileSync(this.filename, "utf8");
    this.headerWritten = content.includes("ip_address");
    if (!this.headerWritten) {
      fs.writeFileSync(
        this.filename,
        `${APPLICATION_LOG_TABLE_HEADER}\n${content}`,
        "utf8",
      );
      this.headerWritten = true;
    }
  }

  log(
    info: winston.Logform.TransformableInfo,
    callback: () => void,
  ): void {
    setImmediate(() => {
      this.emit("logged", info);
    });

    try {
      const record = normalizeWinstonInfo(info);
      const row = formatTableDataRow(record);
      fs.appendFileSync(this.filename, `${row}\n`, "utf8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[application-log] file write failed: ${message}\n`);
    }

    callback();
  }
}

// Winston types are not imported as a value; declare minimal shape for log().
import type winston from "winston";
