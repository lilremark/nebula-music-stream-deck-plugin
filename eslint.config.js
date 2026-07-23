import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["com.lilremark.nebula-music.sdPlugin/bin/**", "coverage/**", "*.streamDeckPlugin"]
  },
  {
    ...js.configs.recommended,
    files: ["**/*.{js,mjs}"],
    languageOptions: {
      globals: globals.node
    }
  },
  {
    files: ["**/*.ts"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error"
    }
  }
);
