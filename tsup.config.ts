import { defineConfig } from "tsup";
import { copyFile, mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { glob } from "glob";

export default defineConfig({
  entry: ["src/cli/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: false,
  target: "node16",
  outDir: "dist",
  shims: true,
  external: [
    "commander",
    "inquirer",
    "chalk",
    "winston",
    "openai",
    "dotenv",
    "i18next",
    "octokit",
  ],
  splitting: true,
  treeshake: {
    preset: "smallest",
  },
  platform: "node",
  minify: true,
  esbuildOptions(options) {
    options.mainFields = ["module", "main"];
    options.resolveExtensions = [".ts", ".js", ".mjs", ".cjs", ".json"];
    options.keepNames = true;
    options.pure = ["console.log", "console.debug"];
    options.legalComments = "none";
  },
  async onSuccess() {
    console.log("Build completed successfully!");

    // dist/index.js에 shebang 추가
    try {
      const indexPath = join("dist", "index.js");
      const content = await readFile(indexPath, "utf-8");

      // shebang이 이미 있는지 확인
      if (!content.startsWith("#!/usr/bin/env node")) {
        // shebang 추가
        const updatedContent = `#!/usr/bin/env node\n${content}`;
        await writeFile(indexPath, updatedContent, "utf-8");
        console.log(`Added shebang to ${indexPath}`);
      }
    } catch (error) {
      console.error("Error adding shebang:", error);
    }

    // 수동으로 i18n 파일 복사 (최적화: 필수 언어 파일만 복사)
    try {
      // 단일 경로에만 복사 (dist/locales)
      await mkdir(join("dist", "locales"), { recursive: true });

      // 소스 파일 직접 지정
      const sourceFiles = [
        {
          src: join("src", "i18n", "locales", "en.json"),
          dest: join("dist", "locales", "en.json"),
        },
        {
          src: join("src", "i18n", "locales", "ko.json"),
          dest: join("dist", "locales", "ko.json"),
        },
      ];

      // 각 파일 복사
      for (const { src, dest } of sourceFiles) {
        await copyFile(src, dest);
        console.log(`Copied: ${src} -> ${dest}`);
      }

      console.log("Locale files copied successfully!");
    } catch (error) {
      console.error("Error copying locale files:", error);
    }
  },
});
