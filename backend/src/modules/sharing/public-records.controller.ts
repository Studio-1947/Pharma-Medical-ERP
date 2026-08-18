import { Controller, Get, Param } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Public } from "../../common/decorators/roles.decorator";
import { SharingService } from "./sharing.service";

/**
 * The one unauthenticated surface in the API.
 *
 * Kept in its own controller so the absence of guards is obvious on review
 * rather than buried among authenticated routes. Rate limited harder than the
 * default because the token is the only thing standing between the internet
 * and a patient record, and an unthrottled endpoint invites enumeration.
 */
@ApiTags("public")
@Controller("public")
export class PublicRecordsController {
  constructor(private readonly service: SharingService) {}

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get("records/:token")
  @ApiOperation({
    summary: "Resolve a patient share link. No authentication required.",
  })
  resolve(@Param("token") token: string) {
    return this.service.resolvePublic(token);
  }
}
