import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const projectRoot = new URL("../", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    let candidate;

    if (specifier.startsWith("@/")) {
      candidate = new URL(specifier.slice(2), projectRoot);
    } else if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      context.parentURL?.startsWith("file:")
    ) {
      candidate = new URL(specifier, context.parentURL);
    }

    if (!candidate) {
      return nextResolve(specifier, context);
    }

    const candidatePath = fileURLToPath(candidate);
    if (candidatePath.split(/[\\/]/).includes("node_modules")) {
      return nextResolve(specifier, context);
    }

    const extension = extname(candidate.pathname);
    if (extension) {
      return [".ts", ".tsx", ".json"].includes(extension) &&
        existsSync(candidatePath)
        ? { url: candidate.href, format: "module", shortCircuit: true }
        : nextResolve(specifier, context);
    }

    for (const extension of [".ts", ".tsx", ".js", ".mjs"]) {
      const resolved = new URL(`${candidate.href}${extension}`);
      if (existsSync(fileURLToPath(resolved))) {
        return { url: resolved.href, format: "module", shortCircuit: true };
      }
    }

    return nextResolve(specifier, context);
  },

  load(url, context, nextLoad) {
    if (url.endsWith(".json")) {
      return {
        format: "module",
        shortCircuit: true,
        source: `export default ${readFileSync(new URL(url), "utf8")};`,
      };
    }

    if (url.endsWith(".ts") || url.endsWith(".tsx")) {
      const source = readFileSync(new URL(url), "utf8");
      const transformed = ts.transpileModule(source, {
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
        fileName: fileURLToPath(url),
      });

      return {
        format: "module",
        shortCircuit: true,
        source: transformed.outputText,
      };
    }

    return nextLoad(url, context);
  },
});
