import type { ServiceState } from "../adminServices";
import { ReportsTab } from "./reports/ReportsTab";
import type { EtlReportRunSelection } from "../../../../utils/etlReportsApi";

interface EtlSectionProps {
  idPrefix: string;
  workerStatus: ServiceState;
  workerApiRunning: boolean;
  onReportsStart: (selection: EtlReportRunSelection) => void;
  onWorkerStop: () => void;
}

export function EtlSection({
  idPrefix,
  workerStatus,
  workerApiRunning,
  onReportsStart,
  onWorkerStop,
}: EtlSectionProps) {
  return (
    <div className="adminPage__rssPanel">
      <ReportsTab
        idPrefix={idPrefix}
        workerStatus={workerStatus}
        workerApiRunning={workerApiRunning}
        onReportsStart={onReportsStart}
        onWorkerStop={onWorkerStop}
      />
    </div>
  );
}
