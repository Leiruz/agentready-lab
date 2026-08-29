// Declares this Worker's main module to @cloudflare/workers-types, which is
// what gives `ctx.exports` / `import { exports } from "cloudflare:workers"`
// a type. Without it `Cloudflare.Exports` is `{}` and the only way to reach
// the Worker from a test is the deprecated `SELF` binding.
//
// `wrangler types` generates an equivalent declaration. It is written by hand
// here because the Worker has no bindings yet, so there is nothing else for a
// generated file to contain and nothing to keep in sync.
declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import("./src/index.js");
  }
}
