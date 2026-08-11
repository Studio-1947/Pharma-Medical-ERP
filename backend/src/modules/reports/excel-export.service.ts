import { Injectable } from "@nestjs/common";
import * as ExcelJS from "exceljs";

export interface ExcelColumn {
  header: string;
  key: string;
  width?: number;
  numFmt?: string;
}

@Injectable()
export class ExcelExportService {
  /**
   * Generates a styled .xlsx Excel buffer for any table data.
   */
  async generateExcelBuffer(
    title: string,
    columns: ExcelColumn[],
    data: Record<string, any>[],
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "PharmERP Healthcare Systems";
    workbook.created = new Date();

    const sheetName = title.slice(0, 31).replace(/[\*\?:\/\\\[\]]/g, "");
    const sheet = workbook.addWorksheet(sheetName);

    // Gridlines enabled
    sheet.views = [{ showGridLines: true }];

    // Row 1: Title Header Banner
    sheet.mergeCells(1, 1, 1, columns.length);
    const titleCell = sheet.getCell(1, 1);
    titleCell.value = `${title.toUpperCase()} — PHARMERP`;
    titleCell.font = { name: "Arial", size: 13, bold: true, color: { argb: "FFFFFFFF" } };
    titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF065F46" } }; // Dark Emerald
    titleCell.alignment = { vertical: "middle", horizontal: "center" };
    sheet.getRow(1).height = 28;

    // Row 2: Sub-info (Timestamp)
    sheet.mergeCells(2, 1, 2, columns.length);
    const subCell = sheet.getCell(2, 1);
    subCell.value = `Generated on: ${new Date().toLocaleString("en-IN")}`;
    subCell.font = { name: "Arial", size: 9, italic: true, color: { argb: "FF475569" } };
    subCell.alignment = { vertical: "middle", horizontal: "right" };

    // Row 4: Column Headers
    const headerRow = sheet.getRow(4);
    headerRow.values = columns.map((c) => c.header);
    headerRow.height = 24;
    headerRow.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };

    columns.forEach((col, colIdx) => {
      const cell = headerRow.getCell(colIdx + 1);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF059669" } }; // Emerald
      cell.alignment = { vertical: "middle", horizontal: "left" };
      sheet.getColumn(colIdx + 1).width = col.width ?? 18;
    });

    // Data rows starting from Row 5
    data.forEach((rowObj, rIdx) => {
      const rowValues = columns.map((col) => rowObj[col.key] ?? "");
      const row = sheet.addRow(rowValues);
      row.height = 20;

      // Alternating row background shading
      const bgColor = rIdx % 2 === 0 ? "FFFFFFFF" : "FFF8FAFC";

      columns.forEach((col, cIdx) => {
        const cell = row.getCell(cIdx + 1);
        cell.font = { name: "Arial", size: 9.5 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
        cell.alignment = { vertical: "middle" };

        if (col.numFmt) {
          cell.numFmt = col.numFmt;
          cell.alignment = { vertical: "middle", horizontal: "right" };
        }
      });
    });

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }
}
