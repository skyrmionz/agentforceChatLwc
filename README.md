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
- Agentforce reasoning display

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

## Step 2.1: Create an HTML Stylization Prompt Action

1. Create a Flex Template Prompt called "HTML Stylize", with one input text field named "Answer"
2. Use this prompt here:
   "Stylize the Agent's answer: "{!$Input:Answer}" with HTML. Use the following guideline:

   Paragraphs for regular sentences: Use the `<p>` for paragraphs of regular text.
   Example: `<p>` This is a regular sentence. `</p>`
   Bold for Key Points: Use the `<b>` tag to emphasize important words or critical information.
   Example: `<b>`This is a crucial fact.`</b>`
   Italics for Additional/Supporting Details: Use the `<i>` tag for extra context or secondary notes.
   Example: `<i>`Here's some supplementary insight.`</i>`
   Line Breaks: Use `<br>` to neatly separate ideas or paragraphs. Always leave space in between them.
   Example: `<p>` Hello! `</p>` `<br>` `<p>` How are you? `</p>`
   Bullet Points: Use `<ul>` and `<li>` for any list of items or points.
   Blockquotes: Use `<blockquote>` for quotes, longer excerpts, or cited content.
   Headings: Use headings to signify titles or subsections. If you need section titles or headers, use `<h1>`, `<h2>`, etc.
   Example: `<h1>`Main Title`</h1>`, `<h2>`Subsection`</h2>`

   Whenever you provide an answer, ensure it is easy to read and visually structured using these HTML (and other you deem relevant) elements where appropriate.

   For any `<think>` `</think>` in the response, leave it at the very top of HTML stylized text."
3. Choose 4O as the model, save, and then activate.
4. Create an Action from the Prompt named "HTML Stylize".
   - Action Instructions: "Before returning any answer to the user, make sure to HTML stylize the response using this prompt."
   - Input "Answer" Instructions: "This is your answer to the user's query"
      - Require Input
   - Output "Prompt Response" Instructions: "This is the complete HTML stylized response to provide back to the user."
      - Show in Conversation

## Step 2.2: Create an HTML Stylization Prompt Action

1. Navigate to Agents in your Salesforce org
2. Create a new agent or select an existing one
3. Configure the agent with all desired Topics
4. Add to each topic the HTML Stylized Prompt Action
5. Add these additional instructions to each Action:
   - "Always include in your final response your thought process of how you found the answer to the user's question. Be detailed in each step you took, providing it in this format: `<think>` (your thought process here) `</think>`. 
   
   Put it above the HTML stylized text you provide back."
   - "All of your replies must be HTML stylized."

6. Save and Activate your Agent
7. Navigate back outside the Agent Builder to copy the Agent ID (it will look like `0XxHu000000l1BHKAY`)

### Step 3: Configure Connected App for API Access

1. Navigate to Setup → App Manager → New Connected App
2. Fill in the basic information:
   - Connected App Name: `Agentforce API`
   - API Name: `Agentforce_API`
   - Contact Email: Your email
3. Enable OAuth Settings:
   - `Enable OAuth Settings`: Checked
   - Callback URL: `https://login.salesforce.com`
   - Selected OAuth Scopes:
     - Access chatbot services (chatbot_api)
     - Access the Salesforce API Platform (sfap_api)
     - Manage user data via APIs (api)
     - Perform requests at any time (refresh_token, offline_access)
4. `Enable Client Credentials Flow`: Checked
5. `Issue JSON Web Token (JWT)-based access tokens for named users`: Checked
4. Save the connected app
5. Once saved, go and view the Connected App
   - Press Manage Consumer Details:
   - Retrieve the and save it for later:
      - Consumer Key
      - Consumer Secret

### Step 4: Configure Named Credentials

## Step 4.1: Configure External Credentials
1. Navigate to Setup → Named Credentials → External Credentials Tab → New
2. Fill in the details:
   - Label: `AgentforceAPI`
   - Name:  `AgentforceAPI`
   - Authentication Protocol: `OAuth 2.0`
   - Authentication Flow Type: `Client Credentials with Client Secret Flow`
   - Identity Provider URL: `https://your-domain.my.salesforce.com/services/oauth2/token`
3. Save the External Credential
4. Navigate into the External Credential
5. Scroll down and create a new `Principal`
   - Parameter Name: `NamedPrincipal`
   - Sequence Number: `1`
   - Client ID: (The Consumer Key from your Connected App)
   - Client Secret: (The Consumer Secret from your Connected App)
   - Save

##Step 4.2: Configure Named Credentials
1. Navigate back to Named Credentials → Named Credentials Tab → New
2. Fill in the details:
   - Label: `AgentforceAPI`
   - Name: `AgentforceAPI`
   - URL: `https://api.salesforce.com/einstein/ai-agent/v1`
   - `Enabled for Callouts` toggled on
   - External Credential: `AgentforceAPI` (the one you just created)
   - `Generate Authorization Header` checked
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
4. Create another trusted site for Murf.ai Audio Playback (if using TTS):
   - Trusted Site Name: `MurfAudioPlayback`
   - Trusted Site URL: `https://murf.ai`
   - Active: Checked
5. Save the remote site settings

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
4. Create another trusted site for Murf.ai Audio Playback (if using TTS):
   - Trusted Site Name: `MurfAudioPlayback`
   - Trusted Site URL: `https://murf.ai`
   - Active: Checked
   - Context: Allow all contexts
5. Save the trusted sites

### Step 7: Set Up Experience Cloud Site

1. Navigate to Digital Experiences → All Sites
2. Create a new site or select an existing one
3. Build the site using the Lightning Web Runtime or Aura framework
4. In the Experience Builder:
   - Drag the Agentforce Messenger Chat component onto your page (sometimes you may need to refresh multiple times)
   - Configure the component properties:
     - Agent Name: Display name for your agent
     - Agent ID: The ID you copied from Agentforce
     - Murf API Key: Your Murf.ai API key (if using text-to-speech)
     - Default Dark Mode: Choose your preference
5. Save and publish your site

### Step 8: Configure Experience Cloud CSP

1. Navigate to Digital Experiences → All Sites → [Your Site] → Administration → Security & Privacy
2. Under Content Security Policy (CSP), add the following domains to your CSP Trusted Sites:
   - Your Salesforce org domain
   - `https://api.murf.ai` (if using TTS)
   - `https://murf.ai`
3. Save and publish your site

### Step 9: Test the Integration

1. Navigate to your Experience Cloud site
2. Verify the chat widget appears
3. Test sending messages and receiving responses
4. If using voice mode, test the voice recognition and TTS functionality

## Troubleshooting

- If the chat fails to initialize, check your Remote Site Settings and Named Credential configuration
- If TTS is not working, verify your Murf.ai API key is correctly entered in the component configuration
- Check the browser console for JavaScript errors
- Review the Apex debug logs for server-side errors in Developer Console

## Customization

You can customize the appearance and behavior of the chat widget by:

1. Modifying the CSS in `messengerChat.css`
2. Updating default properties in `messengerChat.js`
3. Configuring component properties in Experience Builder

## Looking Forward
- Planning on adding multi-modal image text extraction capabilities to Agent next
- Going to make this a deployable LWC