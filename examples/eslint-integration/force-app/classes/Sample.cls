public with sharing class Sample {
    // VIOLATION: SOQL inside a loop (SoqlInLoop)
    public void soqlInLoop(List<Id> ids) {
        for (Id i : ids) {
            List<Account> a = [SELECT Id FROM Account WHERE Id = :i];
        }
    }

    // VIOLATION: ApexSOQLInjection — public param concatenated into a dynamic query
    public List<SObject> search(String term) {
        return Database.query('SELECT Id FROM Account WHERE Name = \'' + term + '\'');
    }

    // VIOLATION: EmptyCatchBlock
    public void swallow() {
        try { insert new Account(Name = 'x'); } catch (Exception e) { }
    }

    // SAFE: bind variable — should NOT flag ApexSOQLInjection
    public List<Account> safe(String term) {
        return Database.query('SELECT Id FROM Account WHERE Name = :term');
    }
}
