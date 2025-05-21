import { defineConfig } from "tsup";
import { copyFile, mkdir, readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";
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

    // i18n 로케일 파일 복사 - src/i18n/locales/* -> dist/i18n/locales/*
    try {
      // 기본 i18n 디렉토리 생성
      await mkdir(join("dist", "i18n", "locales"), { recursive: true });

      // glob 패턴을 사용하여 모든 JSON 파일 찾기
      const jsonFiles = await glob("src/i18n/locales/**/*.json", {
        nodir: true,
      });

      console.log(`Found ${jsonFiles.length} locale JSON files to copy`);

      // 각 파일 복사
      for (const srcPath of jsonFiles) {
        // 대상 경로 생성 (src/i18n/locales/... -> dist/i18n/locales/...)
        const destPath = srcPath.replace("src/", "dist/");

        // 대상 디렉토리 생성
        await mkdir(dirname(destPath), { recursive: true });

        // 파일 복사
        await copyFile(srcPath, destPath);
        console.log(`Copied: ${srcPath} -> ${destPath}`);
      }

      console.log("Locale files copied successfully!");
    } catch (error) {
      console.error("Error copying locale files:", error);
    }
  },
});
