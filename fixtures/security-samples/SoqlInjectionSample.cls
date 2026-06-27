public with sharing class SoqlInjectionSample {

    // VULNERABLE: VF page parameter concatenated into a dynamic query.
    // Expected: ApexSOQLInjection (critical) on the Database.query line.
    public List<Account> searchByVfParam() {
        String name = ApexPages.currentPage().getParameters().get('name');
        String q = 'SELECT Id FROM Account WHERE Name = \'' + name + '\'';
        return Database.query(q);
    }

    // VULNERABLE: REST request param flows directly into an inline query.
    // Expected: ApexSOQLInjection (critical).
    public List<Contact> searchByRestParam() {
        String city = RestContext.request.params.get('city');
        return Database.query('SELECT Id FROM Contact WHERE MailingCity = \'' + city + '\'');
    }

    // SAFE: bind variable — tainted value but parameterized.
    // Expected: NO ApexSOQLInjection.
    public List<Account> safeWithBind() {
        String name = ApexPages.currentPage().getParameters().get('name');
        return Database.query('SELECT Id FROM Account WHERE Name = :name');
    }

    // SAFE: escapeSingleQuotes sanitizes the tainted value.
    // Expected: NO ApexSOQLInjection.
    public List<Account> safeWithEscape() {
        String name = ApexPages.currentPage().getParameters().get('name');
        String safe = String.escapeSingleQuotes(name);
        return Database.query('SELECT Id FROM Account WHERE Name = \'' + safe + '\'');
    }
}
