# Apex Lint — Rules Reference

41 built-in rules across 6 categories. All rules run by default; use `--rules`, `--categories`, or the config file to restrict the active set.

---

## Security (10 rules)

### ApexSOQLInjection
**Severity:** critical | **ID:** `ApexSOQLInjection`

User-controlled data flows into `Database.query()` without sanitization, enabling SOQL injection attacks.

Uses PMD-style intra-method taint analysis: variables seeded from VF parameters, REST request body, or cookies are tracked through assignment chains until a `Database.query()` sink is reached.

**Triggers on:**
```apex
public void search(String term) {
    String q = ApexPages.currentPage().getParameters().get('q');
    return Database.query('SELECT Id FROM Account WHERE Name = \'' + q + '\'');
}
```

**Fix:** Use bind variables (`:varName`) or `String.escapeSingleQuotes()` before passing to `Database.query()`.

---

### ApexOpenRedirect
**Severity:** high | **ID:** `ApexOpenRedirect`

User-controlled URL is passed directly to `new PageReference(url)`, allowing attackers to redirect users to arbitrary sites.

**Triggers on:**
```apex
String url = ApexPages.currentPage().getParameters().get('returnUrl');
return new PageReference(url);
```

**Fix:** Validate the URL against an allowlist of permitted domains before constructing the `PageReference`.

---

### ApexSSRF
**Severity:** high | **ID:** `ApexSSRF`

User-controlled data flows into `HttpRequest.setEndpoint()`, enabling Server-Side Request Forgery. Attackers can redirect callouts to internal services or exfiltrate data.

**Triggers on:**
```apex
String endpoint = ApexPages.currentPage().getParameters().get('url');
HttpRequest req = new HttpRequest();
req.setEndpoint(endpoint);
```

**Fix:** Use Named Credentials for callout endpoints, or validate against an allowlist of permitted hosts.

---

### ApexXSSFromURLParam
**Severity:** high | **ID:** `ApexXSSFromURLParam`

Taint-tracked: user-controlled data flows into a Visualforce page message without HTML escaping.

Sinks covered:
- `new ApexPages.Message(severity, taintedMsg)` — renders to the page
- `obj.addError(taintedMsg, false)` — unescaped error rendered in page

**Triggers on:**
```apex
String msg = ApexPages.currentPage().getParameters().get('msg');
ApexPages.addMessage(new ApexPages.Message(ApexPages.Severity.ERROR, msg));
```

**Fix:** Sanitize with `String.escapeHtml4(msg)` before constructing the message.

---

### ApexXSSFromEscapeFalse
**Severity:** high | **ID:** `ApexXSSFromEscapeFalse`

`addError(message, false)` disables HTML escaping on the second argument. If the message is not a hardcoded literal, user-controlled content may be rendered as raw HTML.

**Triggers on:**
```apex
String errMsg = computeMessage(inputParam);
record.addError(errMsg, false);  // escapeXml=false
```

**Does not trigger on:**
```apex
record.addError('Account is inactive', false);  // literal — no XSS risk
```

**Fix:** Remove the `false` argument to enable default escaping, or sanitize with `String.escapeHtml4()`.

---

### ApexBadCrypto
**Severity:** high | **ID:** `ApexBadCrypto`

Weak cryptographic algorithm used in a `Crypto.*` call. MD5 and SHA-1 are broken for collision resistance; HMAC-SHA1 is deprecated.

**Triggers on:**
```apex
Blob hash = Crypto.generateDigest('MD5', data);
Blob hash = Crypto.generateDigest('SHA1', data);
Blob hmac = Crypto.generateMac('HMAC-SHA1', data, key);
```

**Fix:** Use `SHA-256` (digest) or `HMAC-SHA256` (MAC) instead.

---

### ApexCSRF
**Severity:** moderate | **ID:** `ApexCSRF`

DML in a controller constructor executes on every GET request, including page loads triggered by `<apex:page>` inside an email link. An attacker can craft a link that causes unintended data modification.

**Triggers on:**
```apex
public MyController() {
    insert new Log__c(Event__c = 'viewed');
}
```

**Fix:** Move DML to an action method triggered by user interaction, not the constructor.

---

### ApexSharingViolations
**Severity:** high | **ID:** `ApexSharingViolations`

Classes that execute SOQL or DML without an explicit sharing declaration (`with sharing` / `without sharing` / `inherited sharing`) inherit the calling context's sharing, which may be overly permissive.

**Triggers on:**
```apex
public class AccountService {        // no sharing keyword
    public List<Account> getAll() { return [SELECT Id FROM Account]; }
}
```

**Fix:** Add `with sharing` to enforce record-level access, or explicitly choose `without sharing` / `inherited sharing` with a comment explaining the intent.

---

### DatabaseQueryWithVariable
**Severity:** high | **ID:** `DatabaseQueryWithVariable`

`Database.query()` receives a non-literal argument, indicating dynamic SOQL. Even if the immediate variable is not user-controlled, dynamic SOQL risks injection from callers higher in the call stack.

**Triggers on:**
```apex
String soql = 'SELECT Id FROM ' + objectName;
List<SObject> recs = Database.query(soql);
```

**Fix:** Prefer inline SOQL with bind variables. If dynamic object names are required, validate against `Schema.getGlobalDescribe().keySet()`.

---

### UnguardedCrudOperation ★
**Severity:** high | **ID:** `UnguardedCrudOperation`

DML operation (`insert`, `update`, `delete`, `upsert`, `undelete`) performed without a preceding CRUD/FLS check (`Schema.sObjectType.*.isCreateable()` / `isUpdateable()` / `isDeletable()`). Fails at runtime when executed by a user who lacks the required object permission.

★ Type-aware — requires `--metadata-root` to identify custom SObjects. Without metadata, fires only on standard objects.

**Triggers on:**
```apex
public void createRecord(Account a) {
    insert a;  // no CRUD check
}
```

**Fix:** Check `Schema.sObjectType.Account.isCreateable()` before DML, or use `with sharing` and the Security class:
```apex
if (!Schema.sObjectType.Account.isCreateable()) {
    throw new SecurityException('Insufficient privileges');
}
insert a;
```

---

## Performance (6 rules)

### SoqlInLoop
**Severity:** high | **ID:** `SoqlInLoop`

SOQL inside a loop executes one query per iteration, rapidly consuming the 100-query governor limit.

**Triggers on:**
```apex
for (Account a : accounts) {
    List<Contact> cs = [SELECT Id FROM Contact WHERE AccountId = :a.Id];
}
```

**Fix:** Move the query outside the loop using an `IN` clause; build a map by ID for lookup.

---

### DmlInLoop
**Severity:** high | **ID:** `DmlInLoop`

DML inside a loop consumes one DML statement per iteration (150-statement limit) and can trigger cascade operations repeatedly.

**Triggers on:**
```apex
for (Account a : accounts) {
    a.Rating = 'Warm';
    update a;
}
```

**Fix:** Collect records to update in a list; execute DML once after the loop.

---

### SoqlInBatchExecute
**Severity:** moderate | **ID:** `SoqlInBatchExecute`

SOQL inside `Database.Batchable.execute()` that is not bound to the `scope` parameter re-queries data independently, defeating the purpose of batching and potentially hitting limits.

**Triggers on:**
```apex
public void execute(Database.BatchableContext bc, List<Account> scope) {
    List<Contact> cs = [SELECT Id FROM Contact];  // not bound to scope
}
```

**Fix:** Bind the query to the scope: `WHERE AccountId IN :scope` or `WHERE AccountId IN :scopeIds`.

---

### HttpCalloutInLoop
**Severity:** high | **ID:** `HttpCalloutInLoop`

HTTP callouts inside a loop consume one callout slot per iteration (100-callout limit per transaction).

**Triggers on:**
```apex
for (String id : ids) {
    Http h = new Http();
    // ...
}
```

**Fix:** Batch the callout payload outside the loop, or use a `Queueable` chain to spread callouts across transactions.

---

### SystemDebugInLoop
**Severity:** low | **ID:** `SystemDebugInLoop`

`System.debug()` inside a loop floods debug logs and consumes CPU statement limits with no production benefit.

**Triggers on:**
```apex
for (Account a : accounts) {
    System.debug('Processing: ' + a.Name);
}
```

**Fix:** Move debug logging outside the loop, or guard with a debug-mode flag.

---

### AvoidNonRestrictiveQueries
**Severity:** low | **ID:** `AvoidNonRestrictiveQueries`

SOQL without a `WHERE` clause or `LIMIT` fetches all records in the object, hitting row limits on large orgs.

**Triggers on:**
```apex
List<Account> accs = [SELECT Id, Name FROM Account];
```

**Does not trigger in** `@IsTest` classes (test data is controlled).

**Fix:** Add a `WHERE` clause or a `LIMIT N` to bound the result set.

---

## Error-Prone (6 rules)

### EmptyCatchBlock
**Severity:** moderate | **ID:** `EmptyCatchBlock`

Empty catch blocks silently swallow exceptions, making failures invisible and impossible to debug.

**Triggers on:**
```apex
try {
    insert record;
} catch (Exception e) {
    // nothing
}
```

**Fix:** Log the exception with `System.debug(e)` at minimum, or re-throw if it cannot be handled.

---

### FutureMethodChaining
**Severity:** high | **ID:** `FutureMethodChaining`

Calling a `@future` method from another `@future` method throws `System.AsyncException` at runtime — Apex does not allow future-from-future calls.

**Triggers on:**
```apex
@future
public static void processA() {
    processB();  // processB is also @future → runtime exception
}
```

**Fix:** Replace one of the methods with a `Queueable` that enqueues the next step as a separate job.

---

### InaccessibleAuraEnabledGetter
**Severity:** high | **ID:** `InaccessibleAuraEnabledGetter`

`@AuraEnabled` properties or methods without `public` or `global` access are invisible to LWC/Aura components and silently return `null`.

**Triggers on:**
```apex
@AuraEnabled
private String name { get; set; }  // private — LWC cannot read this
```

**Fix:** Change the access modifier to `public` or `global`.

---

### TestMethodsMustBeInTestClasses
**Severity:** high | **ID:** `TestMethodsMustBeInTestClasses`

`@IsTest` methods inside non-`@IsTest` classes are never executed by the test runner and provide false confidence in coverage.

**Triggers on:**
```apex
public class AccountService {
    @IsTest
    public static void testInsert() { /* never runs */ }
}
```

**Fix:** Move test methods to a dedicated `@IsTest` class.

---

### OverrideBothEqualsAndHashcode
**Severity:** moderate | **ID:** `OverrideBothEqualsAndHashcode`

Overriding `equals()` without `hashCode()` (or vice versa) breaks `Map` and `Set` behavior: objects that compare equal may hash differently, causing incorrect lookups.

**Triggers on:**
```apex
public Boolean equals(Object o) { ... }
// hashCode() not defined
```

**Fix:** Always implement both. `hashCode()` must be consistent with `equals()`.

---

### AvoidHardcodedId
**Severity:** moderate | **ID:** `AvoidHardcodedId`

Hardcoded Salesforce record IDs (15- or 18-character) differ across orgs. Code that hardcodes IDs from production will fail in sandbox or scratch orgs.

**Triggers on:**
```apex
String acctId = '001000000000001';
```

**Fix:** Query for the record by a stable business key, or store the ID in Custom Metadata / Custom Settings.

---

## Design (8 rules)

### TriggerInlineLogic
**Severity:** moderate | **ID:** `TriggerInlineLogic`

Triggers with inline SOQL or DML are untestable in isolation and cannot be reused. All logic should be delegated to a handler class.

**Triggers on:** any `.trigger` file with inline `[SELECT …]` or DML statements.

**Fix:** Move all logic to `AccountTriggerHandler.cls` and call `AccountTriggerHandler.handle(Trigger.new, Trigger.old)` from the trigger body.

---

### CyclomaticComplexity
**Severity:** moderate | **ID:** `CyclomaticComplexity`

Methods with cyclomatic complexity above 10 have too many independent paths to test exhaustively. Threshold: 10.

**Triggers on:** methods with many branches (`if`, `for`, `while`, `catch`, ternary `?:`).

**Fix:** Extract independent decision trees into helper methods.

---

### CognitiveComplexity
**Severity:** moderate | **ID:** `CognitiveComplexity`

Measures how hard code is to _read_ — nesting depth multiplies the cognitive load. Score = Σ (1 + nestingDepth) per structural node. Threshold: 15.

**Triggers on:** deeply nested if-loops-try blocks even if cyclomatic complexity is moderate.

**Fix:** Use early returns to flatten nesting; extract inner blocks into named methods.

---

### AvoidDeeplyNestedIfStmts
**Severity:** moderate | **ID:** `AvoidDeeplyNestedIfStmts`

Nesting depth above 4 levels makes code nearly impossible to follow. Threshold: 4.

**Fix:** Apply the "guard clause" pattern — check failure conditions early and return, leaving the happy path unindented.

---

### ExcessiveParameterList
**Severity:** low | **ID:** `ExcessiveParameterList`

Methods with more than 5 parameters are hard to call correctly and test. Threshold: 5.

**Fix:** Group related parameters into a dedicated class or inner type.

---

### ExcessivePublicCount
**Severity:** low | **ID:** `ExcessivePublicCount`

Classes with more than 45 public members expose an API surface too large to understand or maintain. Threshold: 45.

**Fix:** Split into focused, single-responsibility classes.

---

### TooManyFields
**Severity:** low | **ID:** `TooManyFields`

Classes with more than 15 fields are doing too much. Threshold: 15.

**Fix:** Extract cohesive subsets of fields into separate value objects.

---

### UnusedPrivateMethod
**Severity:** low | **ID:** `UnusedPrivateMethod`

Private methods with no internal call sites are dead code. Skips framework entry points (`execute`, `start`, `finish`, `compareTo`, etc.) and annotation-driven methods (`@AuraEnabled`, `@InvocableMethod`, `@Future`, `@IsTest`, HTTP annotations, `@TestVisible`).

**Triggers on:** private methods in outer classes that are never called anywhere in the same class body.

**Fix:** Remove the method, or add `@TestVisible` if it is accessed from a test class.

---

## Best Practices (10 rules)

### TestWithoutAsserts
**Severity:** moderate | **ID:** `TestWithoutAsserts`

Test methods with no assertions verify nothing — they can pass even when the code under test is completely broken.

**Triggers on:**
```apex
@IsTest
static void testInsert() {
    insert new Account(Name = 'Test');
    // no Assert.* or System.assert* call
}
```

**Fix:** Add at minimum `System.assertNotEquals(null, result)` or use the `Assert` class (`Assert.isNotNull(result)`).

---

### SeeAllDataTrue
**Severity:** moderate | **ID:** `SeeAllDataTrue`

`@IsTest(SeeAllData=true)` makes tests depend on live org data. Tests become order-dependent, environment-dependent, and will fail in scratch orgs or fresh sandboxes.

**Triggers on:**
```apex
@IsTest(SeeAllData=true)
public class MyTest { ... }
```

**Fix:** Use `@TestSetup` with factory methods to create controlled test data.

---

### HardcodedUrl
**Severity:** moderate | **ID:** `HardcodedUrl`

Hardcoded `http://` or `https://` URLs in string literals cannot be changed per environment without a code deployment.

**Fix:** Store URLs in Named Credentials (for callout endpoints), Custom Metadata, or Custom Settings.

---

### AvoidGlobalModifier
**Severity:** low | **ID:** `AvoidGlobalModifier`

`global` classes and methods cannot be deleted once included in a managed package. Once released, you are committed to their API forever.

**Fix:** Use `public` unless the class is genuinely part of a managed package's external API.

---

### AvoidFutureAnnotation
**Severity:** low | **ID:** `AvoidFutureAnnotation`

`@future` methods cannot be monitored, chained, or given error-handling callbacks. For new async code, `Queueable` with `System.attachFinalizer()` provides all the same capabilities with better control.

**Fix:** Implement `Queueable` and call `System.enqueueJob(new MyJob(...))`. Attach a `Finalizer` for error handling.

---

### DebugsShouldUseLoggingLevel
**Severity:** low | **ID:** `DebugsShouldUseLoggingLevel`

`System.debug(msg)` without a `LoggingLevel` argument defaults to `DEBUG` level and executes the string concatenation even when debug logging is disabled, wasting CPU.

**Triggers on:**
```apex
System.debug('Processing account: ' + acct.Name);
```

**Fix:**
```apex
System.debug(LoggingLevel.DEBUG, 'Processing account: ' + acct.Name);
```

---

### ApexAssertionsShouldIncludeMessage
**Severity:** low | **ID:** `ApexAssertionsShouldIncludeMessage`

Test assertions without a descriptive message produce unhelpful failure output like `"Expected: true, Actual: false"` with no context.

**Triggers on:**
```apex
System.assertEquals(expected, actual);
```

**Fix:**
```apex
System.assertEquals(expected, actual, 'Account name should match after update');
```

---

### ApexUnitTestMethodShouldHaveIsTestAnnotation
**Severity:** low | **ID:** `ApexUnitTestMethodShouldHaveIsTestAnnotation`

The `testMethod` keyword is deprecated. The `@IsTest` annotation is the modern equivalent and is required for new API versions.

**Triggers on:**
```apex
static testMethod void myTest() { ... }
```

**Fix:**
```apex
@IsTest
static void myTest() { ... }
```

---

### ApexUnitTestClassShouldHaveRunAs
**Severity:** low | **ID:** `ApexUnitTestClassShouldHaveRunAs`

Test classes with no `System.runAs()` call only test behavior as the running user (typically a System Administrator). Permissions, record visibility, and sharing rules are not validated.

**Fix:** Add at least one test method that uses `System.runAs(testUser)` to verify behavior under restricted permissions.

---

### QueueableWithoutFinalizer
**Severity:** low | **ID:** `QueueableWithoutFinalizer`

`Queueable` implementations without a `Finalizer` have no way to detect or recover from async failures — the job silently disappears if it throws an uncaught exception.

**Triggers on:**
```apex
public class MyJob implements Queueable {
    public void execute(QueueableContext ctx) { ... }
    // no System.attachFinalizer() call
}
```

**Fix:** Call `System.attachFinalizer(new MyFinalizer())` at the start of `execute()`.

---

## Code Style (1 rule)

### MethodNamingConventions
**Severity:** low | **ID:** `MethodNamingConventions`

Method names should use camelCase per Apex naming conventions. Skips test methods, constructors, and override-required framework methods (`execute`, `compareTo`, etc.).

**Triggers on:**
```apex
public void Process_Records() { ... }
public void ProcessRecords() { ... }
```

**Fix:**
```apex
public void processRecords() { ... }
```

---

## Config File Reference

Create `apexlint.config.json` (or `.apexlintrc.json`) in your project root:

```json
{
  "rules": ["SoqlInLoop", "DmlInLoop", "ApexSOQLInjection"],
  "excludeRules": ["MethodNamingConventions", "AvoidGlobalModifier"],
  "categories": ["security", "performance"],
  "severityOverrides": {
    "EmptyCatchBlock": "critical",
    "AvoidNonRestrictiveQueries": "info"
  },
  "excludePaths": [
    "**/test/**",
    "**/*Test.cls",
    "**/legacy/**"
  ],
  "maxViolationsPerFile": 50,
  "metadataRoots": ["./force-app/main/default"],
  "failOn": "high"
}
```

**Field precedence:** CLI flags take priority over config file values. `rules` (include list) takes priority over `excludeRules`/`categories`.

| Field | CLI equivalent | Description |
|-------|---------------|-------------|
| `rules` | `--rules` | Run only these rule IDs |
| `excludeRules` | `--exclude-rules` | Skip these rule IDs |
| `categories` | `--categories` | Run only these categories |
| `severityOverrides` | — | Override per-rule severity |
| `excludePaths` | — | Glob patterns for files to skip |
| `maxViolationsPerFile` | — | Cap violations per file |
| `metadataRoots` | `--metadata-root` | sfdx roots for SObject metadata |
| `failOn` | `--fail-on` | Minimum severity for non-zero exit |

## Suppression

```apex
// NOPMD                         suppress all rules on this line
// NOPMD: SoqlInLoop             suppress one rule on this line

@SuppressWarnings('PMD.SoqlInLoop')   // suppress one rule for a method or class
@SuppressWarnings('PMD')              // suppress all rules for a method or class
```
