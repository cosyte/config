import cosyte from "@cosyte/eslint-config";

// `test/fixtures/**` is DATA, not source: those trees are copied into a temp directory and handed to
// the real tools, and two of them are deliberately broken (a config that throws, a file prettier
// wants to rewrite). Linting them would grade the fixtures instead of the package.
export default cosyte(import.meta.dirname, { ignores: ["test/fixtures/**"] });
