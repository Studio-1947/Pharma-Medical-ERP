import { 
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, 
  Req, BadRequestException 
} from "@nestjs/common";
import { FastifyRequest } from "fastify";
import { ApiBearerAuth, ApiOperation, ApiTags, ApiConsumes, ApiBody } from "@nestjs/swagger";
import { PrescriptionsService } from "./prescriptions.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser, JwtPayload } from "../../common/decorators/current-user.decorator";
import { S3Service } from "../../common/s3/s3.service";
import {
  createPrescriptionSchema,
  updatePrescriptionSchema,
  verifyPrescriptionSchema,
  queryPrescriptionSchema,
} from "@pharmerp/types";

import { assertBranchAccess, resolveBranchScope } from "../../common/auth/branch-scope";

@ApiTags("prescriptions")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("prescriptions")
export class PrescriptionsController {
  constructor(
    private readonly service: PrescriptionsService,
    private readonly s3Service: S3Service,
  ) {}

  @Post("upload")
  @Roles("admin", "pharmacist", "doctor")
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: { file: { type: "string", format: "binary" } },
    },
  })
  @ApiOperation({ summary: "Upload prescription image to S3/Minio" })
  async uploadFile(@Req() req: FastifyRequest) {
    if (!req.isMultipart()) {
      throw new BadRequestException("Request is not multipart");
    }

    const data = await req.file();
    if (!data) {
      throw new BadRequestException("No file uploaded");
    }

    const isImage = data.mimetype.startsWith("image/");
    const isPdf =
      data.mimetype === "application/pdf" ||
      (data.filename?.toLowerCase().endsWith(".pdf") ?? false);
    if (!isImage && !isPdf) {
      throw new BadRequestException("Only image or PDF files are allowed");
    }

    const buffer = await data.toBuffer();
    const key = `prescriptions/${Date.now()}-${data.filename}`;
    
    await this.s3Service.upload(buffer, key, data.mimetype);
    const url = await this.s3Service.getPresignedUrl(key);
    
    return { key, url };
  }

  @Get()
  @Roles("admin", "pharmacist", "cashier", "doctor")
  @ApiOperation({ summary: "List prescriptions with optional filters" })
  findAll(
    @Query() q: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    const dto = queryPrescriptionSchema.parse(q);
    const branchId = resolveBranchScope(user, dto.branchId);
    return this.service.findAll({ ...dto, branchId });
  }

  @Get(":id")
  @Roles("admin", "pharmacist", "cashier", "doctor")
  @ApiOperation({ summary: "Get prescription by ID with items and patient" })
  async findOne(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    const prescription = await this.service.findOne(id);
    assertBranchAccess(user, prescription.data.branchId);
    return prescription;
  }

  @Post()
  @Roles("admin", "pharmacist", "cashier", "doctor")
  @ApiOperation({ summary: "Create a new prescription (auto-verified when created by a doctor)" })
  create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    return this.service.create(createPrescriptionSchema.parse(body), user);
  }

  @Patch(":id")
  @Roles("admin", "pharmacist")
  @ApiOperation({ summary: "Edit a prescription that is still pending verification" })
  async update(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const prescription = await this.service.findOne(id);
    assertBranchAccess(user, prescription.data.branchId);
    return this.service.update(id, updatePrescriptionSchema.parse(body));
  }

  @Post(":id/verify")
  @Roles("admin", "pharmacist")
  @ApiOperation({ summary: "Verify or reject a prescription" })
  async verify(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    const prescription = await this.service.findOne(id);
    assertBranchAccess(user, prescription.data.branchId);
    return this.service.verify(id, verifyPrescriptionSchema.parse(body), user.sub);
  }

  @Delete(":id")
  @Roles("admin")
  @ApiOperation({ summary: "Soft delete a prescription" })
  async remove(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    const prescription = await this.service.findOne(id);
    assertBranchAccess(user, prescription.data.branchId);
    return this.service.remove(id);
  }
}
