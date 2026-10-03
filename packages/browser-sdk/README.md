# @tracedeck/browser

Dependency-free browser instrumentation bridge. Load `/sdk/tracedeck.js` from your TraceDeck server or copy the file into your application.

```html
<script src="https://trace.example.com/sdk/tracedeck.js"></script>
<script>
  TraceDeck.init({ serverUrl: 'https://trace.example.com' })
    .identify({ id: currentUser.id, plan: currentUser.plan })
    .metadata({ build: APP_BUILD, tenant: TENANT_ID });
</script>
```

If a URL contains `?tracedeck_session=...`, the SDK securely streams sanitized app events to that temporary Recording Link session. Common secret fields are redacted before transmission.
