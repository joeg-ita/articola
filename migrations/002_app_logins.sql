-- Sign-in from the mobile app. The app keeps a random secret and opens the browser on
-- /auth/<provider>?app=<sha256(secret)>. After the OAuth callback the user confirms, in that same
-- browser, that the code shown matches the one in the app; the app then trades its secret for a
-- session token (POST /auth/app/token). Rows live ten minutes and are single use.
CREATE TABLE app_logins (
  secret_hash  text PRIMARY KEY,                  -- base64url(sha256(secret)), as sent by the app
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  confirm_hash text NOT NULL,                     -- sha256 of the browser cookie allowed to confirm
  confirmed    boolean NOT NULL DEFAULT false,
  expires_at   timestamptz NOT NULL
);
