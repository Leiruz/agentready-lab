import { registerHooks } from "node:module";

// Lets plain `node` run the TypeScript in `scripts/` and `packages/*/src`
// without a build step.
//
// Node.js 24 strips types from a `.ts` file with no flag, but it does not do
// TypeScript's `./x.js` -> `./x.ts` specifier remapping, so a relative import
// written the way `moduleResolution: NodeNext` requires fails at runtime with
// ERR_MODULE_NOT_FOUND. The other half of the vice is that writing `./x.ts`
// instead is a TypeScript error (TS5097) unless `allowImportingTsExtensions`
// is enabled, and this repository's tsconfig files are owned elsewhere.
//
// So the source keeps the `.js` specifiers that `tsc` and Vitest both want,
// and this hook supplies the one resolution rule Node is missing. It is
// registered with `--import` in the `specs:*` package scripts and affects
// nothing else. `registerHooks` is synchronous and in-thread, so there is no
// worker and no startup cost worth measuring.
//
// This exists to be deleted: it goes away the moment Node resolves `.js` onto
// `.ts`, or the tsconfig gains `allowImportingTsExtensions`.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const isRelative =
      specifier.startsWith("./") || specifier.startsWith("../");
    if (isRelative && specifier.endsWith(".js")) {
      try {
        return nextResolve(`${specifier.slice(0, -".js".length)}.ts`, context);
      } catch {
        // No sibling .ts file. Fall through so that the caller sees the error
        // for the specifier they actually wrote.
      }
    }
    return nextResolve(specifier, context);
  },
});
