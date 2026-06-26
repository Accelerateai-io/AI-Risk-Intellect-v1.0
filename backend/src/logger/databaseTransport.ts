import Transport from "winston-transport";
import { persistApplicationLog } from "../services/admin/applicationLogWriter.service.js";

export class DatabaseLogTransport extends Transport {
  constructor(opts?: Transport.TransportStreamOptions) {
    super(opts);
  }

  log(info: Record<string, unknown>, callback: () => void): void {
    setImmediate(() => {
      this.emit("logged", info);
    });

    void persistApplicationLog(info).catch((err) => {
      process.stderr.write(
        `[logger] failed to persist application log: ${
          err instanceof Error ? err.message : String(err)
        }\n`,
      );
    });

    callback();
  }
}
