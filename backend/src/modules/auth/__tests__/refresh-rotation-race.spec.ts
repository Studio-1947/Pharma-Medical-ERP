import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHash } from "crypto";
import { UnauthorizedException } from "@nestjs/common";
import { AuthService } from "../auth.service";

vi.mock("argon2", () => ({
  argon2id: 2,
  hash: vi.fn().mockResolvedValue("mocked_hash"),
  verify: vi.fn().mockResolvedValue(true),
}));

/**
 * Refresh tokens are single-use and rotate on every refresh, so two requests
 * carrying the same token cannot be told apart from a replayed theft by the
 * token alone. The old reading was always "theft": the losing request revoked
 * the whole family, including the token just issued to the winner, and the
 * operator was signed out.
 *
 * A page load produces that pair every time the access token has gone stale —
 * the session bootstrap refreshes on mount while the shell's first request
 * 401s and refreshes too — which is why it surfaced after every deploy.
 *
 * These run against an in-memory stand-in for the refresh_tokens table rather
 * than call-assertions on a mock, because what matters is the state the rows
 * end up in across several calls, not which methods were hit.
 */

type Row = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedByTokenId: string | null;
};

const sha256 = (raw: string) => createHash("sha256").update(raw).digest("hex");

class FakeTokenStore {
  rows: Row[] = [];
  private seq = 0;
  users: Record<
    string,
    { id: string; email: string; role: string; isActive: boolean; branchId: null }
  > = {
    "user-1": {
      id: "user-1",
      email: "a@b.c",
      role: "admin",
      isActive: true,
      branchId: null,
    },
  };

  async findUserById(id: string) {
    return this.users[id] ?? null;
  }

  async saveRefreshToken(data: { userId: string; tokenHash: string; expiresAt: Date }) {
    const row: Row = {
      id: `tok-${++this.seq}`,
      userId: data.userId,
      tokenHash: data.tokenHash,
      expiresAt: data.expiresAt,
      revokedAt: null,
      replacedByTokenId: null,
    };
    this.rows.push(row);
    return { id: row.id };
  }

  // Mirrors the SQL: hash match, not revoked, not expired.
  async findValidRefreshToken(tokenHash: string) {
    return (
      this.rows.find(
        (r) => r.tokenHash === tokenHash && !r.revokedAt && r.expiresAt > new Date(),
      ) ?? null
    );
  }

  async findRefreshTokenByHash(tokenHash: string) {
    return this.rows.find((r) => r.tokenHash === tokenHash) ?? null;
  }

  async findRefreshTokenById(id: string) {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async markRefreshTokenReplacedBy(id: string, successorId: string) {
    const row = this.rows.find((r) => r.id === id);
    if (row) {
      row.revokedAt = new Date();
      row.replacedByTokenId = successorId;
    }
  }

  async revokeRefreshToken(id: string) {
    const row = this.rows.find((r) => r.id === id);
    if (row) row.revokedAt = new Date();
  }

  async revokeAllUserTokens(userId: string) {
    for (const r of this.rows) {
      if (r.userId === userId && !r.revokedAt) r.revokedAt = new Date();
    }
  }

  /** Live tokens — the thing an operator's session actually depends on. */
  live() {
    return this.rows.filter((r) => !r.revokedAt);
  }
}

function makeService(graceMs?: number) {
  const repo = new FakeTokenStore();
  const jwt = { sign: vi.fn().mockReturnValue("access-jwt") };
  const config = {
    get: vi.fn((key: string) => {
      if (key === "REFRESH_TOKEN_EXPIRES_IN") return "7d";
      if (key === "REFRESH_ROTATION_GRACE_MS") return graceMs;
      return undefined;
    }),
  };
  const service = new AuthService(repo as any, jwt as any, config as any);
  return { service, repo };
}

/** Seeds a live token for user-1 and hands back its raw value. */
function seedToken(repo: FakeTokenStore, raw = "R1") {
  repo.saveRefreshToken({
    userId: "user-1",
    tokenHash: sha256(raw),
    expiresAt: new Date(Date.now() + 7 * 86_400_000),
  });
  return raw;
}

describe("refresh token rotation — a client racing itself is not a thief", () => {
  let service: AuthService;
  let repo: FakeTokenStore;

  beforeEach(() => {
    ({ service, repo } = makeService());
  });

  it("serves the second request when a page load refreshes twice with one token", async () => {
    const raw = seedToken(repo);

    // The winner: bootstrap rotates R1 away and gets R2.
    const first = await service.refresh(raw);
    expect(first.accessToken).toBeTruthy();

    // The loser: the 401 interceptor, still holding R1 because the winner had
    // not written R2 yet. Postgres serialises the two, so this one reads R1
    // already revoked — the exact shape of the deploy-day 401.
    const second = await service.refresh(raw);
    expect(second.accessToken).toBeTruthy();
    expect(second.refreshToken).not.toBe(first.refreshToken);
  });

  it("leaves the session alive after that race, instead of revoking the family", async () => {
    const raw = seedToken(repo);
    await service.refresh(raw);
    await service.refresh(raw);

    // The whole bug in one assertion: the family used to be wiped here, which
    // killed the token the winner had just been handed.
    expect(repo.live().length).toBeGreaterThan(0);
  });

  it("links a rotated token to its successor", async () => {
    const raw = seedToken(repo);
    await service.refresh(raw);

    const old = await repo.findRefreshTokenByHash(sha256(raw));
    expect(old!.revokedAt).not.toBeNull();
    expect(old!.replacedByTokenId).toBeTruthy();
    // The link must point at a row that exists, or the grace check silently
    // degrades to "never grant" and the race comes back.
    expect(await repo.findRefreshTokenById(old!.replacedByTokenId!)).toBeTruthy();
  });

  it("still treats a replay after the grace window as theft", async () => {
    const raw = seedToken(repo);
    await service.refresh(raw);

    // Age the rotation well past the window. Leaning on a 0ms grace instead
    // is flaky: both calls can land in the same millisecond, and nothing has
    // then elapsed for the window to have been exceeded.
    const rotated = await repo.findRefreshTokenByHash(sha256(raw));
    rotated!.revokedAt = new Date(Date.now() - 60_000);

    await expect(service.refresh(raw)).rejects.toBeInstanceOf(UnauthorizedException);
    // A genuine replay must still cost the attacker — and the user — every
    // session, forcing a password re-authentication.
    expect(repo.live()).toHaveLength(0);
  });

  it("never graces a token that logout revoked", async () => {
    const raw = seedToken(repo);
    await service.logout("user-1");

    // Nothing rotated it, so replacedByTokenId is null and the grace cannot
    // apply however recent the revocation is.
    await expect(service.refresh(raw)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repo.live()).toHaveLength(0);
  });

  it("never graces a rotated token once the successor is revoked", async () => {
    const raw = seedToken(repo);
    await service.refresh(raw); // R1 -> R2, both inside the grace window
    await service.logout("user-1"); // R2 killed

    // Signing out seconds after a refresh must end the session, not leave a
    // several-second hole in which the old token still mints new ones.
    await expect(service.refresh(raw)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repo.live()).toHaveLength(0);
  });

  it("never graces a deactivated user", async () => {
    const raw = seedToken(repo);
    await service.refresh(raw);
    repo.users["user-1"]!.isActive = false;

    await expect(service.refresh(raw)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects a token that was never issued, without touching other sessions", async () => {
    seedToken(repo, "R1");

    await expect(service.refresh("never-issued")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    // An unknown hash names no user, so there is no family to revoke — a
    // stray token must not be able to sign anyone else out.
    expect(repo.live()).toHaveLength(1);
  });
});
