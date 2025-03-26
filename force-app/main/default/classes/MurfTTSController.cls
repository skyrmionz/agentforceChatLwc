public without sharing class MurfTTSController {
    @AuraEnabled(cacheable=false)
    public static String callMurfTTS(String text) {
        Http http = new Http();
        HttpRequest req = new HttpRequest();
        req.setEndpoint('https://api.murf.ai/v1/speech/generate');
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        req.setHeader('api-key', 'ap2_1521e566-5db0-43b0-9b3c-9134cbdafb04');
        
        // Build JSON body
        Map<String, Object> body = new Map<String, Object>{
            'text' => text,
            'voiceId' => 'en-US-amara',
            'style' => 'Conversational'
        };
        req.setBody(JSON.serialize(body));
        
        HttpResponse res = http.send(req);
        if (res.getStatusCode() == 200) {
            // Parse response JSON and extract audioFile URL
            Map<String, Object> result = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
            if (result.containsKey('audioFile')) {
                return (String) result.get('audioFile');
            } else {
                throw new AuraHandledException('No audioFile in response');
            }
        } else {
            throw new AuraHandledException('Murf.ai API request failed: ' + res.getStatus());
        }
    }
}