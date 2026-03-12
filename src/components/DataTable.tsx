import type { ReactNode } from "react";

export const DATA_TABLE_PANEL_CLASS =
  "min-w-0 min-h-0 max-h-full overflow-hidden rounded-2xl border border-base-content/8 bg-base-200/55";
export const DATA_TABLE_CONTAINER_CLASS =
  "flex min-h-0 max-h-full flex-col overflow-hidden rounded-[1rem] border border-base-content/8 bg-transparent";
export const DATA_TABLE_SURFACE_CLASS = "bg-base-200/68";
export const DATA_TABLE_ROW_CLASS =
  `group ${DATA_TABLE_SURFACE_CLASS} transition-colors duration-150 motion-reduce:transition-none hover:bg-base-200/84`;
export const DATA_TABLE_INDEX_HEADER_CLASS =
  "w-12 text-center font-mono text-base-content/50 whitespace-nowrap";
export const DATA_TABLE_HEADER_CLASS =
  "font-mono text-base-content/50 whitespace-nowrap";
export const DATA_TABLE_INDEX_CELL_CLASS =
  "text-center font-mono text-[10px] text-base-content/30 whitespace-nowrap align-top";
export const DATA_TABLE_CELL_CLASS = "max-w-0 align-top";

export interface DataTableColumn<Row> {
  id: string;
  header: ReactNode;
  colClassName?: string;
  headerClassName?: string;
  cellClassName?: string | ((row: Row, index: number) => string | undefined);
  renderCell: (row: Row, index: number) => ReactNode;
}

interface DataTableProps<Row> {
  rows: Row[];
  columns: DataTableColumn<Row>[];
  getRowKey: (row: Row, index: number) => string;
  size?: "xs" | "sm";
  containerClassName?: string;
  scrollAreaClassName?: string;
  tableClassName?: string;
  headerRowClassName?: string;
  rowClassName?: string | ((row: Row, index: number) => string | undefined);
  loadMore?: {
    hasMore: boolean;
    isLoading: boolean;
    label: string;
    loadingLabel: string;
    onLoadMore: () => void;
  };
}

function resolveClassName<Row>(
  value: string | ((row: Row, index: number) => string | undefined) | undefined,
  row: Row,
  index: number
) {
  if (!value) {
    return "";
  }

  return typeof value === "function" ? value(row, index) ?? "" : value;
}

export function DataTable<Row>({
  rows,
  columns,
  getRowKey,
  size = "xs",
  containerClassName,
  scrollAreaClassName,
  tableClassName,
  headerRowClassName,
  rowClassName,
  loadMore,
}: DataTableProps<Row>) {
  const sizeClass = size === "sm" ? "table-sm" : "table-xs";
  const containerClasses =
    containerClassName ?? DATA_TABLE_CONTAINER_CLASS;
  const scrollClasses =
    scrollAreaClassName ?? "min-h-0 flex-1 overflow-y-auto overflow-x-hidden";
  const tableClasses = `table ${sizeClass} table-pin-rows table-fixed w-full ${
    tableClassName ?? ""
  }`.trim();
  const resolvedHeaderRowClassName = headerRowClassName ?? "bg-base-200/80";

  return (
    <div className={containerClasses}>
      <div className={scrollClasses}>
        <table className={tableClasses} style={{ tableLayout: "fixed" }}>
          <colgroup>
            {columns.map((column) => (
              <col key={column.id} className={column.colClassName} />
            ))}
          </colgroup>
          <thead>
            <tr className={resolvedHeaderRowClassName}>
              {columns.map((column) => (
                <th
                  key={column.id}
                  className={`sticky top-0 z-[1] bg-base-200/95 supports-[backdrop-filter]:bg-base-200/82 ${
                    column.headerClassName ?? ""
                  }`}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={getRowKey(row, index)}
                className={resolveClassName(rowClassName, row, index)}
              >
                {columns.map((column) => (
                  <td
                    key={column.id}
                    className={resolveClassName(column.cellClassName, row, index)}
                  >
                    {column.renderCell(row, index)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loadMore?.hasMore ? (
        <div
          className={`flex justify-center border-t border-base-content/8 px-3 pb-3 pt-2 ${DATA_TABLE_SURFACE_CLASS}`}
        >
          <button
            type="button"
            onClick={loadMore.onLoadMore}
            disabled={loadMore.isLoading}
            className="btn btn-ghost btn-xs h-7 px-3 font-mono text-[10px]"
          >
            {loadMore.isLoading ? loadMore.loadingLabel : loadMore.label}
          </button>
        </div>
      ) : null}
    </div>
  );
}
