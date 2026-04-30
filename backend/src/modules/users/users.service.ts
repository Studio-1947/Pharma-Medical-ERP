import { Injectable, NotFoundException } from "@nestjs/common";
import { UsersRepository } from "./users.repository";
import { UpdateUserDto } from "@pharmerp/types";

@Injectable()
export class UsersService {
  constructor(private readonly repo: UsersRepository) {}

  async getAllUsers() {
    return this.repo.findAll();
  }

  async getUserById(id: string) {
    const user = await this.repo.findById(id);
    if (!user) throw new NotFoundException("User not found");
    return user;
  }

  async updateUser(id: string, dto: UpdateUserDto) {
    const user = await this.repo.update(id, dto);
    if (!user) throw new NotFoundException("User not found");
    return user;
  }

  async deleteUser(id: string) {
    const user = await this.repo.delete(id);
    if (!user) throw new NotFoundException("User not found");
    return user;
  }
}
