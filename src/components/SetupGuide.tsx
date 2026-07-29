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

        <h2>2. Video storage (optional for dev)</h2>
        <p>
          Point the upload server at a Railway S3-compatible bucket by setting{' '}
          <code>S3_ENDPOINT</code>, <code>S3_BUCKET</code>, <code>S3_ACCESS_KEY_ID</code> and{' '}
          <code>S3_SECRET_ACCESS_KEY</code> in <code>.env</code>. Without these, videos are
          stored on local disk under <code>./uploads</code> — fine for trying things out.
        </p>

        <p className="muted small">See the README for full setup details.</p>
      </div>
    </div>
  );
}
