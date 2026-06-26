import { useId, useState } from "react";
import { toast } from "react-toastify";
import { Database } from "lucide-react";
import { EtlUploadRow, type EtlUploadStatus } from "../EtlUploadRow";

interface IncidentsTabProps {
  idPrefix: string;
}

export function IncidentsTab({ idPrefix }: IncidentsTabProps) {
  const baseId = useId();
  const [fileName, setFileName] = useState<string | null>(null);
  const [status, setStatus] = useState<EtlUploadStatus>("idle");

  const sid = (name: string) => `${idPrefix}-incidents-${baseId}-${name}`;

  function handleFileSelected(file: File) {
    if (!/\.(csv|xlsx|xls)$/i.test(file.name)) {
      toast.error("Please select a CSV or Excel file.", { autoClose: 2500 });
      return;
    }

    setFileName(file.name);
    setStatus("idle");
    toast.info("Incidents import is not connected yet.", { autoClose: 3000 });
  }

  return (
    <section className="adminPage__card" aria-labelledby={sid("title")}>
      <div className="adminPage__cardHead">
        <span className="settingsPage__cardIconWrap" aria-hidden>
          <Database size={20} strokeWidth={2} />
        </span>
        <div className="adminPage__cardHeadText">
          <h2 id={sid("title")} className="adminPage__cardTitle">
           ETL Incidents Service
          </h2>
          <p className="adminPage__cardHint">
            Import AI Incident Database incident records from a CSV or Excel
            file. Upload incidents.csv (or .xlsx) to load incident data into
            the system.
          </p>
        </div>
      </div>
      <ul className="adminPage__serviceList">
        <EtlUploadRow
          label="Incidents Service"
          status={status}
          fileName={fileName}
          uploading={false}
          inputId={sid("file-input")}
          onFileSelected={handleFileSelected}
        />
      </ul>
    </section>
  );
}
