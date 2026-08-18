import "vitest";
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

/**
 * Teaches TypeScript about the jest-dom matchers that vitest.setup.tsx
 * registers at runtime.
 *
 * The bare `import "vitest"` matters: it anchors the augmentation below to the
 * copy of vitest this workspace resolves. Importing
 * "@testing-library/jest-dom/vitest" instead augments whichever vitest that
 * package resolves, which under pnpm can be a different instance, leaving the
 * matchers untyped even though they exist at runtime.
 *
 * This mirrors the runtime setup, which calls expect.extend(matchers) against
 * the locally imported expect for the same reason.
 */
declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface Assertion<T = any> extends TestingLibraryMatchers<any, T> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface AsymmetricMatchersContaining
    extends TestingLibraryMatchers<any, any> {}
}
