# Messenger Chat LWC with Agentforce Integration

This Lightning Web Component (LWC) provides a Facebook Messenger-like chat interface that integrates with Salesforce Agentforce.

## Features

- Works in Experience Cloud sites
- Dark/light mode toggle with preference saving
- Expandable/collapsible chat window
- Realistic typewriter effect for agent responses
- File attachment capability
- Voice input mode (using Web Speech API)
- Integration with Salesforce Agentforce

## Setup Instructions

### 1. Configure Agentforce

First, you need to set up an Agentforce agent in your Salesforce org:

1. Go to Setup > Einstein > Agentforce
2. Create a new agent or select an existing one
3. Note the Agent ID - you'll need this for configuration

### 2. Update Remote Site Settings

Before you can use this component, you need to update the Remote Site Settings:

1. Edit the file: `force-app/main/default/remoteSiteSettings/AgentforceAPI.remoteSite-meta.xml`
2. Change the `<url>` value to match your Salesforce instance URL
3. Deploy this change to your org

### 3. Deploy the Component

Deploy the component to your Salesforce org using your preferred method (SFDX, Workbench, etc.).

### 4. Add to Experience Cloud Site

1. Edit your Experience Cloud site
2. Drag the "Messenger Chat" component onto your page
3. Configure the component properties:
   - Enter your Agentforce Agent ID (required)
   - Customize the agent name, welcome message, and other options
   - Choose the chat position (bottom-right or bottom-left)
   - Enable/disable file attachments and voice mode as needed

### 5. Publish Your Site

Publish your Experience Cloud site to make the changes available to your users.

## Additional Configuration

### Creating a Chat Transcript Object (Optional)

To save chat transcripts, create a custom object:

1. Go to Setup > Object Manager > Create > Custom Object
2. Create a "Chat_Transcript__c" object with these fields:
   - Messages__c (Long Text Area)
   - User_Id__c (Text)
   - Started_At__c (Date/Time)
   - Agentforce_Session_Id__c (Text)
3. Uncomment the relevant code in the `MessengerChatController.cls` file

## Troubleshooting

- If you see an error about "No Agent ID specified," check that you've entered the correct Agentforce Agent ID in the component configuration.
- If API calls fail, verify that your Remote Site Settings are correctly configured.
- Voice mode requires a browser that supports the Web Speech API (most modern browsers).

## Security Notes

- The component uses the current user's session ID for API calls.
- File attachments are stored as ContentDocument records with standard Salesforce sharing.

## API Information

This component uses the Agentforce API:
- Endpoint: `/services/data/v61.0/einstein/agent/sessions`
- Documentation: https://developer.salesforce.com/docs/einstein/genai/guide/agent-api.html 