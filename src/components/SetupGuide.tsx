import BrandMark from './BrandMark';

export default function SetupGuide() {
  return (
    <div className="setup-guide">
      <div className="setup-card">
        <div className="brand-mark large">
          <BrandMark size={40} />
        </div>
        <h1>Fencing Vault</h1>
        <p className="muted">Almost there — the app needs two things configured before first run.</p>

        <h2>1. InstantDB app ID (required)</h2>
        <ol>
          <li>
            Create a free app at <a href="https://instantdb.com" target="_blank" rel="noreferrer">instantdb.com</a>
          </li>
          <li>
            Copy <code>.env.example</code> to <code>.env</code> and set{' '}
            <code>VITE_INSTANT_APP_ID=&lt;your app id&gt;</code>
          </li>
          <li>
            Optionally push the schema &amp; permissions:{' '}
            <code>npx instant-cli@latest push</code>
          </li>
          <li>Restart the dev server</li>
        </ol>

        <h2>2. Video storage (required)</h2>
        <p>
          Connect a Railway Storage Bucket to the API with the <strong>AWS SDK (Generic)</strong>{' '}
          preset. It provides <code>AWS_ENDPOINT_URL</code>, <code>AWS_S3_BUCKET_NAME</code>,{' '}
          <code>AWS_DEFAULT_REGION</code>, <code>AWS_ACCESS_KEY_ID</code>, and{' '}
          <code>AWS_SECRET_ACCESS_KEY</code>. Configure all five values before starting the API,
          including for local development.
        </p>

        <p className="muted small">See the README for full setup details.</p>
      </div>
    </div>
  );
}
