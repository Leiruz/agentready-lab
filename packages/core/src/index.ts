import type { Validator } from "@cfworker/json-schema";

/**
 * Scaffold marker for `@agentready-lab/core`.
 *
 * None of the engine, model, probe or schema code described in
 * `docs/ARCHITECTURE.md` section 6 exists yet. This module exists so that the
 * package compiles and so that the runtime-neutrality constraint is enforced
 * from the first line of source: this project is compiled with
 * `"lib": ["ES2023"]` and `"types": []`, which makes `fetch`, `process`,
 * `require`, `setTimeout`, `Buffer` and `window` undeclared identifiers here.
 */
export const CORE_PACKAGE_VERSION = "0.0.0";

/**
 * JSON Schema validator type reachable from core without core depending on a
 * Node- or DOM-specific implementation. `@cfworker/json-schema` interprets
 * schemas rather than compiling them with `new Function`, so it runs in both
 * Node.js and workerd.
 */
export type JsonSchemaValidator = Validator;
