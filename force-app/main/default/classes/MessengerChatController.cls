public without sharing class MessengerChatController {
    private static final String BASE_URL = 'callout:AgentforceAPI';

    @AuraEnabled(cacheable=true)
    public static String getOrgDomain() {
        return URL.getOrgDomainUrl().toExternalForm();
    }

    @AuraEnabled(cacheable=false)
    public static String initializeAgentSession(String agentId) {
        if (String.isBlank(agentId)) {
            throw new AuraHandledException('Agent ID cannot be blank');
        }

        try {
            String endpoint = BASE_URL + '/agents/' + agentId + '/sessions';
            System.debug('Calling API endpoint: ' + endpoint);
            
            HttpRequest req = new HttpRequest();
            req.setEndpoint(endpoint);
            req.setMethod('POST');
            req.setHeader('Content-Type','application/json');

            Map<String, Object> payload = new Map<String, Object>{
                'externalSessionKey'    => generateUUID(),
                'instanceConfig'        => new Map<String, Object>{ 'endpoint' => URL.getOrgDomainUrl().toExternalForm() },
                'streamingCapabilities' => new Map<String, Object>{ 'chunkTypes' => new List<String>{ 'Text' } },
                'bypassUser'            => true
            };
            String requestBody = JSON.serialize(payload);
            System.debug('Request payload: ' + requestBody);
            req.setBody(requestBody);

            // Log content type for troubleshooting
            System.debug('Content-Type: ' + req.getHeader('Content-Type'));

            HttpResponse res = new Http().send(req);
            System.debug('Response status: ' + res.getStatusCode());
            System.debug('Response body: ' + res.getBody());
            
            if (res.getStatusCode() == 200 || res.getStatusCode() == 201) {
                Map<String, Object> result = (Map<String, Object>)JSON.deserializeUntyped(res.getBody());
                String sessionId = (String)result.get('sessionId');
                if (String.isBlank(sessionId)) {
                    throw new AuraHandledException('No sessionId returned');
                }
                return sessionId;
            }
            
            // Create a detailed error message
            String errorDetails = 'Status: ' + res.getStatusCode() + 
                                  ', StatusText: ' + res.getStatus() + 
                                  ', Body: ' + res.getBody();
            System.debug('API call failed: ' + errorDetails);
            
            throw new AuraHandledException('Session init failed (' + res.getStatusCode() + '): ' + res.getBody());
        } catch (Exception e) {
            System.debug('Exception in initializeAgentSession: ' + e.getMessage() + ', Type: ' + e.getTypeName() + ', Line: ' + e.getLineNumber() + ', Stack: ' + e.getStackTraceString());
            throw new AuraHandledException('Error initializing session: ' + e.getMessage());
        }
    }

    @AuraEnabled(cacheable=false)
    public static String getAgentRecommendation(String sessionId, String message) {
        if (String.isBlank(sessionId) || String.isBlank(message)) {
            throw new AuraHandledException('Session ID and message cannot be blank');
        }

        Integer seq = incrementSequence(sessionId);
        HttpRequest req = new HttpRequest();
        req.setEndpoint(BASE_URL + '/sessions/' + sessionId + '/messages');
        req.setMethod('POST');
        req.setHeader('Content-Type','application/json');
        req.setTimeout(120000); // extend timeout to 200s :contentReference[oaicite:0]{index=0}

        req.setBody(JSON.serialize(new Map<String, Object>{
            'message'   => new Map<String, Object>{ 'sequenceId' => seq, 'type' => 'Text', 'text' => message },
            'variables' => new List<Object>()
        }));

        HttpResponse res = new Http().send(req);
        if (res.getStatusCode() == 200) {
            Map<String, Object> result = (Map<String, Object>)JSON.deserializeUntyped(res.getBody());
            List<Object> msgs = (List<Object>)result.get('messages');
            return msgs.isEmpty() ? '' : (String)((Map<String, Object>)msgs.get(0)).get('message');
        }
        throw new AuraHandledException('Agent response failed (' + res.getStatusCode() + '): ' + res.getBody());
    }

    @AuraEnabled(cacheable=false)
    public static String endAgentSession(String sessionId) {
        if (String.isBlank(sessionId)) {
            throw new AuraHandledException('Session ID cannot be blank');
        }
        HttpRequest req = new HttpRequest();
        req.setEndpoint(BASE_URL + '/sessions/' + sessionId);
        req.setMethod('DELETE');

        HttpResponse res = new Http().send(req);
        
        // Clear sequence ID for this session when it ends
        if (seqIds.containsKey(sessionId)) {
            seqIds.remove(sessionId);
        }
        
        return (res.getStatusCode() == 204) ? 'Session ended' : 'End error (' + res.getStatusCode() + '): ' + res.getBody();
    }

    @AuraEnabled(cacheable=false)
    public static String saveChatTranscript(String messages) { 
        return null; 
    }

    @AuraEnabled(cacheable=false)
    public static String addMessageToConversation(String sessionId, String message, Boolean isFromUser) { 
            return null;
    }

    private static Map<String,Integer> seqIds = new Map<String,Integer>();
    private static Integer incrementSequence(String sessionId) {
        Integer seq = seqIds.containsKey(sessionId) ? seqIds.get(sessionId) + 1 : 1;
        seqIds.put(sessionId, seq);
        return seq;
    }

    private static String generateUUID() {
        return UUID.randomUUID().toString();
    }
}