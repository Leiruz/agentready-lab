/**
 * The `tool.version` of every report this package produces.
 *
 * Its own module so that `check` can read it without importing the package
 * entry point that imports `check`.
 */
export const CLI_PACKAGE_VERSION = "0.0.0";
