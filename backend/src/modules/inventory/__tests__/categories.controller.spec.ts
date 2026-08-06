import { describe, it, expect, vi, beforeEach } from "vitest";
import { CategoriesController } from "../categories.controller";

describe("CategoriesController", () => {
  let controller: CategoriesController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      listCategories: vi.fn().mockResolvedValue({
        data: [
          { id: "cat-1", name: "Antibiotics" },
          { id: "cat-2", name: "Analgesics" },
        ],
      }),
    };
    controller = new CategoriesController(mockService);
  });

  it("returns categories list from InventoryService", async () => {
    const res = await controller.listCategories();
    expect(mockService.listCategories).toHaveBeenCalled();
    expect(res.data).toHaveLength(2);
    expect(res.data[0].name).toBe("Antibiotics");
  });
});
