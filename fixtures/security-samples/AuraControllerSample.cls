public with sharing class AuraControllerSample {
    // VULNERABLE: @AuraEnabled param concatenated into a dynamic query.
    @AuraEnabled
    public static List<Account> search(String term) {
        return Database.query('SELECT Id FROM Account WHERE Name = \'' + term + '\'');
    }
    // SAFE: same param used as a bind variable.
    @AuraEnabled
    public static List<Account> safeSearch(String term) {
        return Database.query('SELECT Id FROM Account WHERE Name = :term');
    }
}
