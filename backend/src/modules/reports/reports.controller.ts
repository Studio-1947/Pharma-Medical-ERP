import { Controller, Get, Query, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { FastifyReply } from "fastify";
import { ReportsService } from "./reports.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { parse } from "json2csv";

@ApiTags("reports")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("reports")
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Get("gst")
  @Roles("admin", "pharmacist")
  @ApiOperation({ summary: "Export GSTR-1 data as CSV" })
  async getGstReport(
    @Query("branchId") branchId: string,
    @Query("month") month: string,
    @Query("year") year: string,
    @Query("format") format: string,
    @Res() res: FastifyReply,
  ) {
    const data = await this.service.getGstData(branchId, parseInt(month), parseInt(year));
    
    if (format === "csv") {
      const csv = parse(data);
      res.header("Content-Type", "text/csv");
      res.header("Content-Disposition", `attachment; filename="gstr1-${year}-${month}.csv"`);
      return res.send(csv);
    }

    return res.send({ data });
  }

  @Get("schedule-h-register")
  @Roles("admin", "pharmacist")
  @ApiOperation({ summary: "Export Schedule H dispensing register as CSV" })
  async getScheduleHReport(
    @Query("branchId") branchId: string,
    @Query("from") from: string,
    @Query("to") to: string,
    @Query("format") format: string,
    @Res() res: FastifyReply,
  ) {
    const data = await this.service.getScheduleHData(branchId, from, to);
    
    if (format === "csv") {
      const csv = parse(data);
      res.header("Content-Type", "text/csv");
      res.header("Content-Disposition", `attachment; filename="schedule-h-${from}-to-${to}.csv"`);
      return res.send(csv);
    }

    return res.send({ data });
  }
}
