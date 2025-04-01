public without sharing class MessengerChatController {
    private static final String API_ENDPOINT = 'https://api.salesforce.com/einstein/ai-agent/v1';
    private static String AUTH_ENDPOINT {
        get {
            // Use org's domain directly instead of login/test salesforce endpoints
            return URL.getOrgDomainUrl().toExternalForm() + '/services/oauth2/token';
        }
    }
    
    // Cache the access token to avoid multiple authentication requests
    private static String cachedAccessToken;
    private static Long tokenExpiration = 0;

    @AuraEnabled(cacheable=true)
    public static String getOrgDomain() {
        return URL.getOrgDomainUrl().toExternalForm();
    }

    @AuraEnabled(cacheable=false)
    public static String initializeAgentSession(String agentId, String consumerKey, String consumerSecret) {
        System.debug('Starting initializeAgentSession with agentId: ' + agentId);
        
        try {
            if (String.isBlank(agentId)) {
                throw new AuraHandledException('Agent ID cannot be blank');
            }
            
            if (String.isBlank(consumerKey) || String.isBlank(consumerSecret)) {
                throw new AuraHandledException('Consumer Key and Consumer Secret are required');
            }
            
            // Sanitize inputs to prevent special character issues
            consumerKey = consumerKey.trim();
            consumerSecret = consumerSecret.trim();

            // Get OAuth access token
            String accessToken = getAccessToken(consumerKey, consumerSecret);
            
            if (String.isBlank(accessToken)) {
                throw new AuraHandledException('Failed to obtain access token');
            }
            
            String endpoint = API_ENDPOINT + '/agents/' + agentId + '/sessions';
            System.debug('Calling API endpoint: ' + endpoint);
            
            HttpRequest req = new HttpRequest();
            req.setEndpoint(endpoint);
            req.setMethod('POST');
            req.setHeader('Content-Type', 'application/json');
            req.setHeader('Authorization', 'Bearer ' + accessToken);

            Map<String, Object> payload = new Map<String, Object>{
                'externalSessionKey'    => generateUUID(),
                'instanceConfig'        => new Map<String, Object>{ 'endpoint' => URL.getOrgDomainUrl().toExternalForm() },
                'streamingCapabilities' => new Map<String, Object>{ 'chunkTypes' => new List<String>{ 'Text' } },
                'bypassUser'            => true
            };
            String requestBody = JSON.serialize(payload);
            System.debug('Request payload: ' + requestBody);
            req.setBody(requestBody);

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
            String errorMsg = 'Exception in initializeAgentSession: ' + e.getMessage() + 
                ', Type: ' + e.getTypeName() + 
                ', Line: ' + e.getLineNumber();
            System.debug(errorMsg);
            System.debug('Stack trace: ' + e.getStackTraceString());
            throw new AuraHandledException('Error initializing session: ' + e.getMessage());
        }
    }

    @AuraEnabled(cacheable=false)
    public static String getAgentRecommendation(String sessionId, String message, String consumerKey, String consumerSecret) {
        if (String.isBlank(sessionId) || String.isBlank(message)) {
            throw new AuraHandledException('Session ID and message cannot be blank');
        }

        try {
            // Get OAuth access token
            String accessToken = getAccessToken(consumerKey, consumerSecret);
            
            Integer seq = incrementSequence(sessionId);
            HttpRequest req = new HttpRequest();
            req.setEndpoint(API_ENDPOINT + '/sessions/' + sessionId + '/messages');
            req.setMethod('POST');
            req.setHeader('Content-Type', 'application/json');
            req.setHeader('Authorization', 'Bearer ' + accessToken);
            req.setTimeout(120000); // Setting timeout to 120 seconds (matches API documentation)

            Map<String, Object> messagePayload = new Map<String, Object>{
                'message'   => new Map<String, Object>{ 'sequenceId' => seq, 'type' => 'Text', 'text' => message },
                'variables' => new List<Object>()
            };
            
            String requestBody = JSON.serialize(messagePayload);
            System.debug('Request payload: ' + requestBody);
            req.setBody(requestBody);

            HttpResponse res = new Http().send(req);
            System.debug('Response status: ' + res.getStatusCode());
            System.debug('Response body: ' + res.getBody());
            
            if (res.getStatusCode() == 200) {
                Map<String, Object> result = (Map<String, Object>)JSON.deserializeUntyped(res.getBody());
                List<Object> msgs = (List<Object>)result.get('messages');
                return msgs.isEmpty() ? '' : (String)((Map<String, Object>)msgs.get(0)).get('message');
            }
            
            // Log any error responses
            System.debug('API error: Status=' + res.getStatusCode() + ', Body=' + res.getBody());
            throw new AuraHandledException('Agent response failed (' + res.getStatusCode() + '): ' + res.getBody());
        } catch (Exception e) {
            System.debug('Exception in getAgentRecommendation: ' + e.getMessage() + ', Type: ' + e.getTypeName() + ', Line: ' + e.getLineNumber() + ', Stack: ' + e.getStackTraceString());
            throw new AuraHandledException('Error getting agent response: ' + e.getMessage());
        }
    }

    @AuraEnabled(cacheable=false)
    public static String endAgentSession(String sessionId, String consumerKey, String consumerSecret) {
        if (String.isBlank(sessionId)) {
            throw new AuraHandledException('Session ID cannot be blank');
        }
        
        try {
            // Get OAuth access token
            String accessToken = getAccessToken(consumerKey, consumerSecret);
            
            // Use the API_ENDPOINT constant instead of hardcoding the URL
            HttpRequest req = new HttpRequest();
            req.setEndpoint(API_ENDPOINT + '/sessions/' + sessionId);
            req.setMethod('DELETE');
            req.setHeader('Authorization', 'Bearer ' + accessToken);
            req.setHeader('x-session-end-reason', 'UserRequest');
            req.setHeader('Content-Type', 'application/json'); // Add content type header
            
            // Add an empty body with any required parameters to satisfy the arg2 requirement
            req.setBody('{}');
            
            System.debug('Ending session with endpoint: ' + req.getEndpoint());
            HttpResponse res = new Http().send(req);
            System.debug('End session response: Status=' + res.getStatusCode() + ', Body=' + res.getBody());
            
            // Clear sequence ID for this session when it ends
            if (seqIds.containsKey(sessionId)) {
                seqIds.remove(sessionId);
            }
            
            return (res.getStatusCode() == 204) ? 'Session ended' : 'End error (' + res.getStatusCode() + '): ' + res.getBody();
        } catch (Exception e) {
            System.debug('Exception in endAgentSession: ' + e.getMessage());
            throw new AuraHandledException('Error ending session: ' + e.getMessage());
        }
    }
    
    // Method to get access token using client credentials flow
    private static String getAccessToken(String consumerKey, String consumerSecret) {
        if (String.isBlank(consumerKey) || String.isBlank(consumerSecret)) {
            throw new AuraHandledException('Consumer Key and Consumer Secret are required for authentication');
        }
        
        // Check if we have a valid cached token
        Long currentTime = System.currentTimeMillis() / 1000;
        if (String.isNotBlank(cachedAccessToken) && tokenExpiration > currentTime + 60) {
            // Return cached token if it's not going to expire in the next minute
            System.debug('Using cached access token');
            return cachedAccessToken;
        }
        
        try {
            System.debug('Requesting new access token');
            // Build the authentication request using client credentials flow
            HttpRequest req = new HttpRequest();
            req.setEndpoint(AUTH_ENDPOINT);
            req.setMethod('POST');
            req.setHeader('Content-Type', 'application/x-www-form-urlencoded');
            
            // Set timeout to 30 seconds
            req.setTimeout(30000);
            
            // Prepare request body for client credentials flow - using string concatenation instead of URL encoding
            String requestBody = 'grant_type=client_credentials' +
                '&client_id=' + consumerKey +
                '&client_secret=' + consumerSecret;
            
            System.debug('Auth request body: ' + requestBody.replace(consumerSecret, '[REDACTED]'));
            req.setBody(requestBody);
            
            // Log attempt to get token
            System.debug('Sending auth request to: ' + AUTH_ENDPOINT);
            
            HttpResponse res = new Http().send(req);
            System.debug('Auth response status: ' + res.getStatusCode());
            System.debug('Auth response body: ' + res.getBody());
            
            if (res.getStatusCode() == 200) {
                Map<String, Object> tokenResponse = (Map<String, Object>)JSON.deserializeUntyped(res.getBody());
                cachedAccessToken = (String)tokenResponse.get('access_token');
                
                if (String.isBlank(cachedAccessToken)) {
                    System.debug('Error: No access_token in response');
                    throw new AuraHandledException('No access_token returned in authentication response');
                }
                
                // Calculate token expiration (default to 30 minutes if not provided)
                Integer expiresIn = tokenResponse.containsKey('expires_in') 
                    ? Integer.valueOf(tokenResponse.get('expires_in')) 
                    : 1800; // 30 minutes in seconds
                
                tokenExpiration = currentTime + expiresIn;
                System.debug('Token expires in: ' + expiresIn + ' seconds');
                
                return cachedAccessToken;
            }
            
            System.debug('Auth error: ' + res.getStatusCode() + ' ' + res.getStatus());
            System.debug('Auth error body: ' + res.getBody());
            throw new AuraHandledException('Authentication failed: ' + res.getStatusCode() + ' ' + res.getBody());
        } catch (Exception e) {
            System.debug('Exception getting access token: ' + e.getMessage() + ', Type: ' + e.getTypeName() + ', Line: ' + e.getLineNumber() + ', Stack: ' + e.getStackTraceString());
            throw new AuraHandledException('Error authenticating: ' + e.getMessage());
        }
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