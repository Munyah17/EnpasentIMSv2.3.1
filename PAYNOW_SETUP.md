# Paynow Integration Setup

The Paynow payment system requires environment variables to be configured on your deployment platform (Vercel/Netlify).

## Required Environment Variables

### For USD Payments
- `PAYNOW_USD_INTEGRATION_ID` - Your Paynow USD integration ID
- `PAYNOW_USD_INTEGRATION_KEY` - Your Paynow USD integration key

### For ZiG Payments  
- `PAYNOW_ZIG_INTEGRATION_ID` - Your Paynow ZiG integration ID
- `PAYNOW_ZIG_INTEGRATION_KEY` - Your Paynow ZiG integration key

### Optional
- `PAYNOW_LIVE` - Set to `true` when Paynow approves your integrations for live use

## How to Set Up

### On Vercel
1. Go to your project dashboard
2. Settings → Environment Variables
3. Add each variable above with your actual Paynow credentials
4. Redeploy the project

### On Netlify
1. Go to Site Settings → Environment Variables
2. Add each variable above with your actual Paynow credentials
3. Redeploy the site

## Getting Paynow Credentials

1. Log into your Paynow merchant account at paynow.co.zw
2. Navigate to Integrations
3. Create or view your existing integrations
4. Copy the Integration ID and Integration Key for each currency

## Troubleshooting

**"Paynow declined the request" - Instant Failure**
- This usually means the environment variables are not set on the server
- Check your deployment platform's environment variables
- Ensure the variables are named exactly as shown above (case-sensitive)

**"Paynow is not configured for USD"**
- The USD integration credentials are missing
- Add PAYNOW_USD_INTEGRATION_ID and PAYNOW_USD_INTEGRATION_KEY

**"Paynow is not configured for ZWG"**
- The ZiG integration credentials are missing
- Add PAYNOW_ZIG_INTEGRATION_ID and PAYNOW_ZIG_INTEGRATION_KEY

## Test Mode vs Live Mode

While your Paynow integrations are in test mode:
- Do NOT set `PAYNOW_LIVE=true`
- The system will withhold the payer's email to avoid test mode rejections
- Once Paynow approves your integrations for live use, set `PAYNOW_LIVE=true`
