# Agentforce Chat LWC

A Lightning Web Component that integrates with Salesforce's Agentforce API to provide an interactive chatbot experience within your Experience Cloud site or Salesforce org.

## Features

- Floating chat widget that can be embedded in Experience Cloud sites
- Text-to-speech with Murf.ai API
- Voice recognition (browser-based)
- Dark/light mode
- Expandable and draggable chat window
- Responsive design
- Rich formatting for chat messages

## Deployment Instructions

### Prerequisites

- Salesforce org with Experience Cloud
- Agentforce access
- Murf.ai API key (if using text-to-speech functionality)

### Step 1: Deploy the Code

1. Clone this repository:
   ```
   git clone https://github.com/skyrmionz/agentforceChatLwc.git
   cd agentforceChatLwc
   ```

2. Deploy to your org using Salesforce CLI:
   ```
   sfdx force:source:deploy -p force-app
   ```

3. Assign the permission set to users:
   ```
   sfdx force:user:permset:assign -n MessengerChatPermissions
   ```

### Step 2: Set Up Agentforce

1. Navigate to Einstein → Agents in your Salesforce org
2. Create a new agent or select an existing one
3. Configure the agent with the required capabilities
4. Copy the Agent ID (it will look like `0XxHu000000l1BHKAY`)

### Step 3: Configure Connected App for API Access

1. Navigate to Setup → App Manager → New Connected App
2. Fill in the basic information:
   - Connected App Name: `Agentforce API`
   - API Name: `Agentforce_API`
   - Contact Email: Your email
3. Enable OAuth Settings:
   - Enable OAuth Settings: Checked
   - Callback URL: `https://your-domain.my.salesforce.com/services/authcallback/Agentforce_API`
   - Selected OAuth Scopes:
     - Access and manage your data (api)
     - Perform requests on your behalf at any time (refresh_token, offline_access)
4. Save the connected app
5. Once saved, note the Consumer Key and Consumer Secret

### Step 4: Configure Named Credential

1. Navigate to Setup → Named Credentials → New Named Credential
2. Fill in the details:
   - Label: `AgentforceAPI`
   - Name: `AgentforceAPI`
   - URL: Use your Salesforce org URL (e.g., `https://your-org-name.my.salesforce.com`)
   - Identity Type: `Named Principal`
   - Authentication Protocol: `OAuth 2.0`
   - Authentication Provider: Create a new one for Salesforce (or use existing)
   - Scope: `api refresh_token`
   - Start Authentication Flow on Save: Checked
3. Save the Named Credential

### Step 5: Set Up Remote Site Settings

1. Navigate to Setup → Remote Site Settings → New Remote Site
2. Create a remote site for the Agentforce API:
   - Remote Site Name: `AgentforceAPI`
   - Remote Site URL: Your Salesforce org URL (same as Named Credential)
   - Active: Checked
3. Create another remote site for Murf.ai (if using TTS):
   - Remote Site Name: `MurfAPI`
   - Remote Site URL: `https://api.murf.ai`
   - Active: Checked
4. Save the remote site settings

### Step 6: Set Up CSP Trusted Sites

1. Navigate to Setup → CSP Trusted Sites → New Trusted Site
2. Create a trusted site for Agentforce API:
   - Trusted Site Name: `AgentforceAPI`
   - Trusted Site URL: Your Salesforce org URL
   - Active: Checked
   - Context: Allow all contexts
3. Create another trusted site for Murf.ai (if using TTS):
   - Trusted Site Name: `MurfAPI`
   - Trusted Site URL: `https://api.murf.ai`
   - Active: Checked
   - Context: Allow all contexts
4. Save the trusted sites

### Step 7: Set Up Experience Cloud Site

1. Navigate to Digital Experiences → All Sites
2. Create a new site or select an existing one
3. Build the site using the Lightning Web Runtime or Aura framework
4. In the Experience Builder:
   - Drag the Agentforce Messenger Chat component onto your page
   - Configure the component properties:
     - Agent Name: Display name for your agent
     - Agent ID: The ID you copied from Agentforce
     - Murf API Key: Your Murf.ai API key (if using text-to-speech)
     - Default Dark Mode: Choose your preference
     - Allow Voice Mode: Enable if using voice interaction
5. Save and publish your site

### Step 8: Configure Experience Cloud CSP

1. Navigate to Digital Experiences → All Sites → [Your Site] → Administration → Security & Privacy
2. Under Content Security Policy (CSP), add the following domains to your CSP Trusted Sites:
   - Your Salesforce org domain
   - `https://api.murf.ai` (if using TTS)

### Step 9: Test the Integration

1. Navigate to your Experience Cloud site
2. Verify the chat widget appears
3. Test sending messages and receiving responses
4. If using voice mode, test the voice recognition and TTS functionality

## Troubleshooting

- If the chat fails to initialize, check your Remote Site Settings and Named Credential configuration
- If TTS is not working, verify your Murf.ai API key is correctly entered in the component configuration
- Check the browser console for JavaScript errors
- Review the Apex debug logs for server-side errors

## Customization

You can customize the appearance and behavior of the chat widget by:

1. Modifying the CSS in `messengerChat.css`
2. Updating default properties in `messengerChat.js`
3. Configuring component properties in Experience Builder

## License

This project is licensed under the MIT License - see the LICENSE file for details.
