/**
 * Fixture for: SoqlInBatchExecute, FutureMethodChaining, DatabaseQueryWithVariable
 */
public class BatchService implements Database.Batchable<SObject> {

    public Database.QueryLocator start(Database.BatchableContext bc) {
        return Database.getQueryLocator([SELECT Id FROM Contact]);
    }

    // VIOLATION: SoqlInBatchExecute — SOQL not bound to scope parameter
    public void execute(Database.BatchableContext bc, List<Contact> scope) {
        List<Contact> contacts = [SELECT Id, AccountId FROM Contact WHERE Id != null]; // NOPMD: DmlInLoop
        for (Contact c : contacts) {
            c.Description = 'processed';
        }
        update contacts;
    }

    public void finish(Database.BatchableContext bc) {}

    // SAFE: scope variable is bound in SOQL — should NOT flag SoqlInBatchExecute
    public static void safeExecute(Database.BatchableContext bc, List<Contact> scope) {
        List<Contact> enriched = [SELECT Id, Email FROM Contact WHERE Id IN :scope];
        update enriched;
    }

    // VIOLATION: FutureMethodChaining — futureTwo calls futureOne
    @future
    public static void futureOne() {
        System.debug('futureOne');
    }

    @future
    public static void futureTwo() {
        futureOne(); // calls another @future method
    }

    // VIOLATION: DatabaseQueryWithVariable — dynamic SOQL injection risk
    public static List<SObject> dangerousQuery(String soqlString) {
        return Database.query(soqlString);
    }

    // SAFE: static string literal — should NOT flag DatabaseQueryWithVariable
    public static List<Account> safeQuery() {
        return Database.query('SELECT Id FROM Account LIMIT 10');
    }
}
