export default [
  {
    files: ["**/*.ts"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module" },
    rules: { "no-unused-vars": "error", semi: ["error", "always"] },
  },
];
