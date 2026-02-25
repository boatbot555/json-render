import { DuckDBInstance } from "@duckdb/node-api";

let instance: DuckDBInstance | null = null;
let connection: Awaited<ReturnType<DuckDBInstance["connect"]>> | null = null;

async function getConnection() {
  if (!connection) {
    instance = await DuckDBInstance.create(":memory:");
    connection = await instance.connect();
  }
  return connection;
}

export async function initDatabase(csvContent: string, tableName: string = "data") {
  const conn = await getConnection();

  // Drop existing table if any
  await conn.run(`DROP TABLE IF EXISTS ${tableName}`);

  // Create table from CSV using DuckDB's read_csv_auto
  // We write CSV to a temp approach: use DuckDB's ability to read CSV from string
  // Actually, DuckDB doesn't read CSV from string directly via SQL, so we use a workaround
  // We'll create the table by inserting the CSV content as a parameter

  // Write CSV to a temp file
  const fs = await import("fs");
  const path = await import("path");
  const os = await import("os");
  const tmpFile = path.join(os.tmpdir(), `duckdb_upload_${Date.now()}.csv`);
  fs.writeFileSync(tmpFile, csvContent, "utf-8");

  try {
    await conn.run(`CREATE TABLE ${tableName} AS SELECT * FROM read_csv_auto('${tmpFile}')`);
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

export async function executeQuery(sql: string): Promise<Record<string, unknown>[]> {
  const conn = await getConnection();
  const result = await conn.run(sql);

  const rows: Record<string, unknown>[] = [];
  const reader = result.getRows();

  for (const row of reader) {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < result.columnCount; i++) {
      const name = result.columnName(i);
      obj[name] = row[i];
    }
    rows.push(obj);
  }

  return rows;
}

export async function getTableSchema(tableName: string = "data") {
  const conn = await getConnection();

  // Get column info
  const columnsResult = await conn.run(`DESCRIBE ${tableName}`);
  const columns: Array<{ name: string; type: string }> = [];
  for (const row of columnsResult.getRows()) {
    columns.push({
      name: String(row[0]),
      type: String(row[1]),
    });
  }

  // Get row count
  const countResult = await conn.run(`SELECT COUNT(*) as cnt FROM ${tableName}`);
  let rowCount = 0;
  for (const row of countResult.getRows()) {
    rowCount = Number(row[0]);
  }

  // Get sample rows
  const sampleResult = await executeQuery(`SELECT * FROM ${tableName} LIMIT 5`);

  return { columns, rowCount, sampleRows: sampleResult };
}

export async function isDataLoaded(): Promise<boolean> {
  if (!connection) return false;
  try {
    await connection.run("SELECT 1 FROM data LIMIT 1");
    return true;
  } catch {
    return false;
  }
}
