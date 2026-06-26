import Transport from "winston-transport";
import type winston from "winston";
import { normalizeWinstonInfo } from "./logRecord.js";
import { queuePersistApplicationLog } from "../services/admin/applicationLogPersist.service.js";

export class DatabaseLogTransport extends Transport {
  log(
    info: winston.Logform.TransformableInfo,
    callback: () => void,
  ): void {
    setImmediate(() => {
      this.emit("logged", info);
    });

    queuePersistApplicationLog(normalizeWinstonInfo(info));
    callback();
  }
}
