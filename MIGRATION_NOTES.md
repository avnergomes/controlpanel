# Migration Notes: Session Token Security

## Current Issue

The session token is currently passed as a URL query parameter:
```javascript
fetch(`${CONFIG.proxyUrl}?action=getData&token=${encodeURIComponent(sessionToken)}`)
```

Tokens in query strings appear in:
- Server logs
- Browser history
- Referer headers to third-party resources
- Analytics tools

## Proposed Solution

Move the session token to POST body:

### Client-side (app.js)

Change `fetchAllSites()` from:
```javascript
// CURRENT (insecure)
const url = `${CONFIG.proxyUrl}?action=getData&token=${encodeURIComponent(sessionToken)}`;
const response = await fetch(url, { redirect: "follow" });
```

To:
```javascript
// IMPLEMENTED (secure) - uses text/plain to avoid CORS preflight
const response = await fetch(CONFIG.proxyUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain' },
  body: JSON.stringify({
    action: 'getData',
    token: sessionToken
  }),
  redirect: 'follow'
});
```

**Note**: `Content-Type: text/plain` is used instead of `application/json` to avoid CORS preflight requests with Google Apps Script.

### Server-side (Google Apps Script)

The `doPost` function needs to handle `action: 'getData'`:

```javascript
function doPost(e) {
  var data = JSON.parse(e.postData.contents);

  // Handle getData action
  if (data.action === 'getData' && data.token) {
    if (!validateSession_(data.token)) {
      return jsonResponse_({ error: 'unauthorized' });
    }
    return fetchAllSitesData_(e);
  }

  // ... existing tracking code ...
}
```

## Migration Steps

1. **Phase 1**: Update Apps Script to accept token in BOTH query param AND POST body
2. **Phase 2**: Update client to use POST body
3. **Phase 3**: Remove query param support from Apps Script after confirming client is updated

## Files to Modify

- `app.js` - Line ~374 (`fetchAllSites` function)
- `google-apps-script-proxy.gs` - `doPost` function

## Status

- [ ] Apps Script updated to accept both methods (TODO: update doPost to handle getData action)
- [x] Client updated to use POST body (2026-03-01)
- [ ] Query param support deprecated
- [ ] Query param support removed
