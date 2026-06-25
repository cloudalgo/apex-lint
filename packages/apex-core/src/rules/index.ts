import type { Rule } from "../engine/types.js";
import { soqlInLoop, dmlInLoop } from "./loops.js";
import {
  emptyCatchBlock, methodNamingConventions, testWithoutAsserts, seeAllDataTrue, hardcodedUrl,
  avoidGlobalModifier, debugsShouldUseLoggingLevel, apexAssertionsShouldIncludeMessage,
  queueableWithoutFinalizer, inaccessibleAuraEnabledGetter, apexXSSFromEscapeFalse,
  apexUnitTestMethodShouldHaveIsTestAnnotation, apexUnitTestClassShouldHaveRunAs,
  testMethodsMustBeInTestClasses, overrideBothEqualsAndHashcode,
} from "./style.js";
import { avoidHardcodedId } from "./hardcoded.js";
import { unguardedCrudOperation } from "./crud.js";
import { soqlInBatchExecute, httpCalloutInLoop, systemDebugInLoop, avoidNonRestrictiveQueries } from "./performance.js";
import { avoidFutureAnnotation, futureMethodChaining, triggerInlineLogic } from "./async.js";
import { apexBadCrypto, apexSOQLInjection, apexOpenRedirect, databaseQueryWithVariable, apexSharingViolations, apexCsrf, apexSSRF, apexXSSFromURLParam } from "./security.js";
import { cyclomaticComplexity, cognitiveComplexity, avoidDeeplyNestedIfStmts, excessiveParameterList, tooManyFields, excessivePublicCount, unusedPrivateMethod } from "./design.js";

/** All built-in rules. The CLI selects/filters from this set via config. */
export const allRules: Rule[] = [
  // Performance
  soqlInLoop,
  dmlInLoop,
  soqlInBatchExecute,
  httpCalloutInLoop,
  systemDebugInLoop,
  avoidNonRestrictiveQueries,
  // Security
  apexSOQLInjection,
  apexOpenRedirect,
  apexBadCrypto,
  apexCsrf,
  apexSharingViolations,
  apexXSSFromEscapeFalse,
  apexSSRF,
  apexXSSFromURLParam,
  databaseQueryWithVariable,
  // Error-prone
  emptyCatchBlock,
  inaccessibleAuraEnabledGetter,
  testMethodsMustBeInTestClasses,
  overrideBothEqualsAndHashcode,
  avoidHardcodedId,
  unguardedCrudOperation,
  futureMethodChaining,
  // Design
  triggerInlineLogic,
  cyclomaticComplexity,
  cognitiveComplexity,
  avoidDeeplyNestedIfStmts,
  excessiveParameterList,
  excessivePublicCount,
  tooManyFields,
  unusedPrivateMethod,
  // Best practices
  testWithoutAsserts,
  seeAllDataTrue,
  hardcodedUrl,
  avoidGlobalModifier,
  avoidFutureAnnotation,
  debugsShouldUseLoggingLevel,
  apexAssertionsShouldIncludeMessage,
  apexUnitTestMethodShouldHaveIsTestAnnotation,
  apexUnitTestClassShouldHaveRunAs,
  queueableWithoutFinalizer,
  // Code style
  methodNamingConventions,
];

export {
  soqlInLoop, dmlInLoop, soqlInBatchExecute, httpCalloutInLoop, systemDebugInLoop,
  avoidNonRestrictiveQueries, apexSOQLInjection, apexOpenRedirect, apexBadCrypto,
  apexCsrf, apexSharingViolations, apexXSSFromEscapeFalse, apexSSRF, apexXSSFromURLParam, databaseQueryWithVariable,
  emptyCatchBlock, inaccessibleAuraEnabledGetter, testMethodsMustBeInTestClasses,
  overrideBothEqualsAndHashcode, methodNamingConventions, avoidHardcodedId,
  unguardedCrudOperation, avoidFutureAnnotation, futureMethodChaining, triggerInlineLogic,
  cyclomaticComplexity, cognitiveComplexity, avoidDeeplyNestedIfStmts, excessiveParameterList,
  excessivePublicCount, tooManyFields, unusedPrivateMethod, testWithoutAsserts, seeAllDataTrue,
  hardcodedUrl, avoidGlobalModifier, debugsShouldUseLoggingLevel, apexAssertionsShouldIncludeMessage,
  apexUnitTestMethodShouldHaveIsTestAnnotation, apexUnitTestClassShouldHaveRunAs,
  queueableWithoutFinalizer,
};
