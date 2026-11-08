import esbuild from "esbuild";
import process from "node:process";
import { createRequire } from "node:module";
import builtins from "builtin-modules";

const require = createRequire(import.meta.url);

const banner = `/* obsidian-chat plugin bundle */`;
const prod = process.argv[2] === "production";

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
    // `ws` probes these optional native addons in try/catch; leave them unresolved.
    "bufferutil",
    "utf-8-validate",
  ],
  format: "cjs",
  target: "es2020",
  // `ws` declares a browser entry that throws; the host needs the Node build.
  // It is only pulled in by a desktop-gated dynamic import, so mobile never
  // evaluates it.
  plugins: [
    {
      name: "ws-node-entry",
      setup(build) {
        build.onResolve({ filter: /^ws$/ }, () => ({
          path: require.resolve("ws").replace(/wrapper\.mjs$|index\.js$/, "index.js"),
        }));
      },
    },
  ],
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
