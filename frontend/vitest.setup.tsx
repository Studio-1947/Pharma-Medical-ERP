import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/react";
import { afterEach, expect, vi } from "vitest";

// Registered explicitly against the `expect` imported here rather than via
// "@testing-library/jest-dom/vitest". Under pnpm that entry can resolve its own
// copy of vitest and extend a different expect instance, leaving the matchers
// missing at runtime with "Invalid Chai property: toBeInTheDocument".
expect.extend(matchers);

// React Testing Library only auto-cleans when it sees the test globals itself;
// with globals enabled through vitest config we unmount explicitly.
afterEach(() => {
  cleanup();
});

// next/image renders a plain <img> under test. Without this the component pulls
// in Next's image loader, which expects a running Next server.
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { priority, fill, ...rest } = props as any;
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt="" {...rest} />;
  },
}));
