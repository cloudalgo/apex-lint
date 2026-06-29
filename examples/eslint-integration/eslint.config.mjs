// ESLint flat config wiring the apex-lint plugin to lint Apex (.cls/.trigger).
// Uses the locally-built plugin; in a real project install
// `@cloudalgo/eslint-plugin-apex` and import it by name instead.
import apex from "../../packages/eslint-plugin-apex/dist/index.js";

export default [
  ...apex.flatConfigs.recommended,
];
