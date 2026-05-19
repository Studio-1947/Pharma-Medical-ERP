import { Module } from "@nestjs/common";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";
import { UsersRepository } from "./users.repository";
import { BranchesController } from "./branches.controller";
import { BranchesService } from "./branches.service";

@Module({
  controllers: [UsersController, BranchesController],
  providers: [UsersService, UsersRepository, BranchesService],
  exports: [UsersService],
})
export class UsersModule {}
