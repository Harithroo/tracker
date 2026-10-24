// Marks an account's email address as confirmed, without the email link.
//
//   npm run user:verify -- you@example.com
//
// The Firebase console has no switch for this, and a confirmation email that
// never arrives otherwise leaves an account with no way in. Needs the
// FIREBASE_* service-account values in .env.local; it doesn't touch MongoDB.
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const email = process.argv[2];
if (!email) {
  console.error("Usage: npm run user:verify -- you@example.com");
  process.exit(1);
}

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
if (!projectId || !clientEmail || !privateKey) {
  console.error(
    "Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY in .env.local."
  );
  process.exit(1);
}

const auth = getAuth(initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) }));

try {
  const user = await auth.getUserByEmail(email);
  if (user.emailVerified) {
    console.log(`${email} is already confirmed — you can log in.`);
  } else {
    await auth.updateUser(user.uid, { emailVerified: true });
    console.log(`✓ ${email} is now confirmed. Log in as normal.`);
  }
} catch (err) {
  if (err.code === "auth/user-not-found") {
    console.error(`No account for ${email}. Sign up first, then re-run this.`);
  } else {
    console.error(err.message);
  }
  process.exit(1);
}
