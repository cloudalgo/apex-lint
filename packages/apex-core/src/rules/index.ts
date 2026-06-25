import type { Rule } from "../engine/types.js";
import { soqlInLoop, dmlInLoop } from "./loops.js";
import { emptyCatchBlock, methodNamingConventions } from "./style.js";
import { avoidHardcodedId } from "./hardcoded.js";
import { unguardedCrudOperation } from "./crud.js";

/** All built-in rules. The CLI selects/filters from this set via config. */
export const allRules: Rule[] = [
  soqlInLoop,
  dmlInLoop,
  emptyCatchBlock,
  methodNamingConventions,
  avoidHardcodedId,
  unguardedCrudOperation,
];

export {
  soqlInLoop,
  dmlInLoop,
  emptyCatchBlock,
  methodNamingConventions,
  avoidHardcodedId,
  unguardedCrudOperation,
};
