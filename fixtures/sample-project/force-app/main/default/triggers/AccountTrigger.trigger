// Fixture for: TriggerInlineLogic
// VIOLATION: SOQL and DML directly in trigger body — should delegate to handler.
trigger AccountTrigger on Account (before insert, after insert, after update) {
    // VIOLATION: TriggerInlineLogic — inline SOQL
    List<Account> existing = [SELECT Id, Name FROM Account WHERE Name != null LIMIT 100];

    // VIOLATION: TriggerInlineLogic — inline DML
    List<Contact> contacts = new List<Contact>();
    for (Account a : Trigger.new) {
        contacts.add(new Contact(LastName = a.Name, AccountId = a.Id));
    }
    insert contacts;
}
