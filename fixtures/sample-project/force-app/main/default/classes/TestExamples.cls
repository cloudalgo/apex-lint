/**
 * Fixture for: TestWithoutAsserts, SeeAllDataTrue
 */
@IsTest
public class TestExamples {

    // VIOLATION: SeeAllDataTrue — accesses live org data
    @IsTest(SeeAllData=true)
    static void testWithLiveData() {
        List<Account> accs = [SELECT Id FROM Account LIMIT 1];
        System.assertEquals(1, accs.size());
    }

    // VIOLATION: TestWithoutAsserts — no assertion calls
    @IsTest
    static void testWithoutAnyAsserts() {
        Account a = new Account(Name = 'Test');
        insert a;
        // no System.assert or Assert.* call — test proves nothing
    }

    // SAFE: has assertion — should NOT flag TestWithoutAsserts
    @IsTest
    static void testWithAssert() {
        Account a = new Account(Name = 'Test');
        insert a;
        Account fetched = [SELECT Id, Name FROM Account WHERE Id = :a.Id];
        System.assertEquals('Test', fetched.Name);
    }

    // SAFE: uses new Assert.* style — should NOT flag TestWithoutAsserts
    @IsTest
    static void testWithAssertClass() {
        Integer result = 2 + 2;
        Assert.areEqual(4, result, 'Math should work');
    }
}
