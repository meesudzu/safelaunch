/**
 * Ambient module declaration for Vite-style `?raw` imports.
 *
 * Tests import fixture HTML files via `import html from "../../../../tests/fixtures/...?raw"`
 * to inline the contents without a runtime fetch. Vitest's resolver treats
 * the suffix as a query and serves the raw file body. This declaration
 * tells TypeScript the same shape so the type-check step passes.
 */
declare module "*?raw" {
  const content: string;
  export default content;
}
