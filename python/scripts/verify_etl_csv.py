"""Quick verification for ETL CSV parsing."""

from pathlib import Path

from app.etl.import_parser import parse_import_file

csv_path = next(Path(__file__).resolve().parents[2].joinpath("backend/storage/etl-reports").glob("*.csv"))
result = parse_import_file(csv_path.read_bytes(), csv_path.name)
print("file:", csv_path.name)
print("totalRows:", result["totalRows"])
print("records:", len(result["records"]))
print("skipped:", len(result["skippedRows"]))
print("failed:", len(result["failedRows"]))
if result["skippedRows"]:
    print("last skip:", result["skippedRows"][-1])
