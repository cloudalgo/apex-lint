public class AccountService {
    public void ProcessAccounts(List<Account> accs) {
        for (Account a : accs) {
            List<Contact> cons = [SELECT Id FROM Contact WHERE AccountId = :a.Id];
            update a;
        }
    }

    public void riskyDelete(Account acc) {
        delete acc;
        Id who = '001000000000abcAAA';
    }

    public void guardedInsert() {
        Account a = new Account(Name = 'Test');
        if (Schema.sObjectType.Account.isCreateable()) {
            insert a;
        }
    }

    public void swallow() {
        try { insert new Account(); } catch (Exception e) {}
    }
}
