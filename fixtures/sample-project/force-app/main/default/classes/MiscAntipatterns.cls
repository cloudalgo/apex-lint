/**
 * Fixture for: HttpCalloutInLoop, SystemDebugInLoop, HardcodedUrl
 */
public class MiscAntipatterns {

    // VIOLATION: HttpCalloutInLoop
    public static void sendCalloutPerRecord(List<String> names) {
        for (String name : names) {
            Http h = new Http();
            HttpRequest req = new HttpRequest();
            req.setEndpoint('callout:MyService/api');
            req.setMethod('POST');
            h.send(req);
        }
    }

    // SAFE: callout outside loop — should NOT flag HttpCalloutInLoop
    public static void sendSingleCallout(String payload) {
        Http h = new Http();
        HttpRequest req = new HttpRequest();
        req.setEndpoint('callout:MyService/api');
        req.setMethod('POST');
        req.setBody(payload);
        h.send(req);
    }

    // VIOLATION: SystemDebugInLoop
    public static void processRecords(List<Account> accs) {
        for (Account a : accs) {
            System.debug('Processing: ' + a.Name); // inside loop
        }
    }

    // SAFE: debug outside loop — should NOT flag SystemDebugInLoop
    public static void logCount(List<Account> accs) {
        System.debug('Total records: ' + accs.size());
    }

    // VIOLATION: HardcodedUrl
    public static String getEndpoint() {
        return 'https://api.example.com/v1/accounts';
    }

    // VIOLATION: HardcodedUrl (HTTP)
    public static String getLegacyEndpoint() {
        return 'http://legacy.example.com/service';
    }

    // SAFE: Named Credential reference — should NOT flag HardcodedUrl
    public static void callWithNamedCred() {
        HttpRequest req = new HttpRequest();
        req.setEndpoint('callout:MyNamedCredential/api/v1');
    }
}
