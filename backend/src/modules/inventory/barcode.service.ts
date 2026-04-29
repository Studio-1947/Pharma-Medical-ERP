import { Injectable, NotFoundException } from "@nestjs/common";
import * as bwipjs from "bwip-js";
import { InventoryRepository } from "./inventory.repository";

@Injectable()
export class BarcodeService {
  constructor(private readonly inventoryRepo: InventoryRepository) {}

  /**
   * Generate a Code-128 barcode PNG for a medicine.
   * Returns a Buffer of the PNG image.
   */
  async generateForMedicine(medicineId: string): Promise<Buffer> {
    const medicine = await this.inventoryRepo.findMedicineById(medicineId);
    if (!medicine) throw new NotFoundException(`Medicine ${medicineId} not found`);

    const code = medicine.barcode ?? medicine.sku;

    const png = await bwipjs.toBuffer({
      bcid: "code128",
      text: code,
      scale: 3,
      height: 10,
      includetext: true,
      textxalign: "center",
    });

    return png;
  }

  /**
   * Generate a barcode for any arbitrary text (e.g. batch label).
   */
  async generateRaw(text: string): Promise<Buffer> {
    return bwipjs.toBuffer({
      bcid: "code128",
      text,
      scale: 3,
      height: 10,
      includetext: true,
      textxalign: "center",
    });
  }
}
