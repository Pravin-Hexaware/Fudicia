import React from 'react';
import { Skeleton } from '@mui/material';

type TableColumn = {
  key: string;
  label: string;
  width?: string;
  minWidth?: string;
  textAlign?: 'left' | 'center' | 'right';
};

type TableRow = Record<string, any>;

type TableProps = {
  columns: TableColumn[];
  rows?: TableRow[];
  loading?: boolean;
  skeletonCount?: number;
  maxHeight?: string;
  onRowClick?: (row: TableRow, index: number) => void;
  showCheckbox?: boolean;
  selectedRows?: Record<number, boolean>;
  onCheckboxChange?: (index: number, checked: boolean) => void;
  onSelectAll?: (checked: boolean) => void;
  hideSelectAllCheckbox?: boolean;
};

const Table: React.FC<TableProps> = ({
  columns,
  rows = [],
  loading = false,
  skeletonCount = 5,
  maxHeight = '400px',
  onRowClick,
  showCheckbox = false,
  selectedRows = {},
  onCheckboxChange,
  onSelectAll,
  hideSelectAllCheckbox = false,
}) => {
  const handleSelectAllChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSelectAll?.(e.target.checked);
  };

  const allSelected = rows.length > 0 && rows.every((_, idx) => selectedRows[idx]);

  return (
    <div className="bg-white overflow-hidden rounded-lg shadow-[0_0_15px_rgba(0,0,0,0.15)]">
      <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight }}>
        <table className="w-full">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#BEBEBE]">
              {showCheckbox && !hideSelectAllCheckbox && (
                <th className="px-2 py-3 text-left text-xs font-bold text-black w-12">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={handleSelectAllChange}
                    className="w-4 h-4 text-indigo-600 rounded"
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-3 py-3 text-xs font-bold text-black whitespace-nowrap ${
                    col.textAlign === 'center' ? 'text-center' : col.textAlign === 'right' ? 'text-right' : 'text-left'
                  }`}
                  style={{ width: col.width, minWidth: col.minWidth }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              // Skeleton loading rows
              [...Array(skeletonCount)].map((_, i) => (
                <tr key={`skeleton-${i}`} className="hover:bg-indigo-50 transition-colors">
                  {showCheckbox && !hideSelectAllCheckbox && (
                    <td className="px-2 py-3 text-sm text-black w-12">
                      <Skeleton width="20px" height="20px" />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td
                      key={`${col.key}-skeleton-${i}`}
                      className={`px-3 py-3 text-sm ${
                        col.textAlign === 'center' ? 'text-center' : col.textAlign === 'right' ? 'text-right' : 'text-left'
                      }`}
                      style={{ width: col.width, minWidth: col.minWidth }}
                    >
                      {col.key === 'number' ? (
                        <Skeleton width="20px" height="20px" />
                      ) : col.textAlign === 'center' ? (
                        <Skeleton width="80%" height="20px" style={{ margin: '0 auto' }} />
                      ) : (
                        <Skeleton width="100%" height="20px" />
                      )}
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length > 0 ? (
              // Data rows
              rows.map((row, index) => {
                const isSelected = selectedRows[index];
                return (
                  <tr
                    key={index}
                    className={`${isSelected ? 'bg-indigo-50' : 'hover:bg-indigo-50'} transition-colors ${
                      onRowClick ? 'cursor-pointer' : ''
                    }`}
                    onClick={() => onRowClick?.(row, index)}
                  >
                    {showCheckbox && !hideSelectAllCheckbox && (
                      <td className="px-2 py-3 text-sm text-black w-12" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => onCheckboxChange?.(index, e.target.checked)}
                          className="w-4 h-4 text-indigo-600 rounded"
                        />
                      </td>
                    )}
                    {columns.map((col) => {
                      const value = row[col.key];
                      return (
                        <td
                          key={`${col.key}-${index}`}
                          className={`px-3 py-3 text-sm text-black ${
                            col.textAlign === 'center' ? 'text-center' : col.textAlign === 'right' ? 'text-right' : 'text-left'
                          }`}
                          style={{ width: col.width, minWidth: col.minWidth }}
                        >
                          {value ?? '-'}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            ) : (
              // No data message
              <tr>
                <td colSpan={columns.length + (showCheckbox && !hideSelectAllCheckbox ? 1 : 0)} className="px-3 py-6 text-center text-gray-500">
                  No data available
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Table;
