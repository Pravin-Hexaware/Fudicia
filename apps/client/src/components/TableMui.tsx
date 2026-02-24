"use client"

import React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Checkbox,
  Skeleton,
  Box,
  Typography,
} from '@mui/material';

// ---------------------
// Type Definitions
// ---------------------

export type TableColumn = {
  key: string;
  label: string;
  width?: string;
  minWidth?: string;
  textAlign?: 'left' | 'center' | 'right';
  render?: (value: any, row: TableRow) => React.ReactNode;
};

export type TableRow = Record<string, any>;

export interface TableMuiProps {
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
}

// ---------------------
// TableMui Component
// ---------------------

const TableMui: React.FC<TableMuiProps> = ({
  columns,
  rows = [],
  loading = false,
  skeletonCount = 5,
  maxHeight = '600px',
  onRowClick,
  showCheckbox = false,
  selectedRows = {},
  onCheckboxChange,
  onSelectAll,
  hideSelectAllCheckbox = false,
}) => {
  // Handle select all checkbox
  const handleSelectAllChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSelectAll?.(e.target.checked);
  };

  // Determine if all rows are selected
  // Use a stable row id when available (row.number) so callers can control selection keys
  const getRowId = (row: TableRow, idx: number) => (row && row.number !== undefined ? row.number : idx);
  const allSelected = rows.length > 0 && rows.every((row, idx) => !!selectedRows[getRowId(row, idx)]);
  const someSelected = rows.length > 0 && rows.some((row, idx) => !!selectedRows[getRowId(row, idx)]);

  // Calculate total columns including checkbox column
  const totalColSpan = columns.length + (showCheckbox && !hideSelectAllCheckbox ? 1 : 0);

  // Show empty state if no data and not loading
  if (!loading && rows.length === 0) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          py: 8,
          px: 3,
        }}
      >
        <Typography variant="h6" fontWeight={600} color="textPrimary" mb={1}>
          No data available
        </Typography>
        <Typography variant="body2" color="textSecondary">
          No records to display
        </Typography>
      </Box>
    );
  }

  return (
    <TableContainer sx={{ maxHeight }}>
      <Table stickyHeader aria-label="sticky table">
        {/* Table Head */}
        <TableHead>
          <TableRow>
            {showCheckbox && !hideSelectAllCheckbox && (
              <TableCell sx={{ width: '48px', padding: '8px' }}>
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected && !allSelected}
                  onChange={handleSelectAllChange}
                  size="small"
                />
              </TableCell>
            )}
            {columns.map((col) => (
              <TableCell
                key={col.key}
                sx={{
                  width: col.width,
                  minWidth: col.minWidth,
                  textAlign: col.textAlign || 'left',
                  padding: '8px',
                }}
              >
                <Typography variant='body3' sx={{ fontWeight: 600 }}>
                  {col.label}
                </Typography>
              </TableCell>
            ))}
          </TableRow>
        </TableHead>

        {/* Table Body */}
        <TableBody>
          {loading ? (
            // Skeleton loading rows
            [...Array(skeletonCount)].map((_, i) => (
              <TableRow key={`skeleton-${i}`}>
                {showCheckbox && !hideSelectAllCheckbox && (
                  <TableCell sx={{ width: '48px', padding: '8px' }}>
                    <Skeleton width="24px" height="24px" />
                  </TableCell>
                )}
                {columns.map((col) => (
                  <TableCell
                    key={`${col.key}-skeleton-${i}`}
                    sx={{
                      width: col.width,
                      minWidth: col.minWidth,
                      textAlign: col.textAlign || 'left',
                      padding: '8px',
                    }}
                  >
                    {col.key === 'number' ? (
                      <Skeleton width="20px" height="20px" />
                    ) : col.textAlign === 'center' ? (
                      <Skeleton width="60%" height="20px" sx={{ mx: 'auto' }} />
                    ) : (
                      <Skeleton width="100%" height="20px" />
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : rows.length > 0 ? (
            // Data rows
            rows.map((row, index) => {
              const rowId = getRowId(row, index);
              const isSelected = !!selectedRows[rowId];
              return (
                <TableRow
                  key={rowId}
                  hover={!showCheckbox}
                  selected={showCheckbox ? false : isSelected}
                  onClick={() => !showCheckbox && onRowClick?.(row, index)}
                  sx={{
                    cursor: showCheckbox ? 'default' : (onRowClick ? 'pointer' : 'default'),
                  }}
                >
                  {showCheckbox && !hideSelectAllCheckbox && (
                    <TableCell
                      sx={{ width: '48px', padding: '8px' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        checked={isSelected}
                        onChange={(e) => onCheckboxChange?.(rowId, e.target.checked)}
                        size="small"
                      />
                    </TableCell>
                  )}
                  {columns.map((col) => {
                    const value = row[col.key];
                    const displayValue = col.render ? col.render(value, row) : value ?? '-';
                    const keyLower = String(col.key || '').toLowerCase().trim();
                    const labelLower = String(col.label || '').toLowerCase().trim();
                    const isCompanyCol = keyLower === 'company' || keyLower === 'company name' || labelLower === 'company' || labelLower === 'company name';

                    return (
                      <TableCell
                        key={`${col.key}-${index}`}
                        sx={{
                          width: col.width,
                          minWidth: col.minWidth,
                          textAlign: col.textAlign || 'left',
                          padding: '8px',
                        }}
                      >
                        {isCompanyCol ? <span className="font-semibold">{displayValue}</span> : displayValue}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })
          ) : (
            // No data message (this shouldn't render due to early return above)
            <TableRow>
              <TableCell colSpan={totalColSpan} sx={{ textAlign: 'center', py: 6 }}>
                <Typography variant="body2" color="textSecondary">
                  No data available
                </Typography>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default TableMui;
