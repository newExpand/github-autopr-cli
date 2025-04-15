import { defineConfig } from "tsup";
import { copyFile, mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { glob } from "glob";

export default defineConfig({
  entry: ["src/cli/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
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
  splitting: false,
  treeshake: true,
  platform: "node",
  minify: false,
  esbuildOptions(options) {
    options.mainFields = ["module", "main"];
    options.resolveExtensions = [".ts", ".js", ".mjs", ".cjs", ".json"];
    options.keepNames = true;
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

    // 수동으로 i18n 파일 복사 (새 구조)
    try {
      // 대상 디렉토리 생성 (수정된 경로)
      await mkdir(join("dist", "i18n", "locales"), { recursive: true });

      // 모든 locale 파일 찾기
      const localeFiles = await glob("src/i18n/locales/**/*.json");

      // 각 파일 복사 (수정된 대상 경로)
      for (const file of localeFiles) {
        // 파일을 dist/i18n/locales에 복사하는 대신 dist/i18n에 복사
        const destPath = file.replace("src/i18n", "dist/i18n");

        // 대상 디렉토리 생성
        await mkdir(join(destPath, "..").replace(/\\/g, "/"), {
          recursive: true,
        });

        // 파일 복사
        await copyFile(file, destPath);
        console.log(`Copied: ${file} -> ${destPath}`);
      }

      console.log("i18n files copied successfully!");
    } catch (error) {
      console.error("Error copying i18n files:", error);
    }
  },
});
